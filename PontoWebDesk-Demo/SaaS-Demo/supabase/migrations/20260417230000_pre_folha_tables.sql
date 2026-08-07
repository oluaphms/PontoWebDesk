-- Migração: Módulo de Pré-Folha (cálculo de jornada)
-- Cria tabelas para cálculos diários e consolidação de período

-- Tabela de cálculos diários de jornada (timesheets diários)
CREATE TABLE IF NOT EXISTS timesheets_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    date DATE NOT NULL,
    
    -- Minutos calculados
    worked_minutes INTEGER DEFAULT 0,
    expected_minutes INTEGER DEFAULT 480, -- 8h padrão
    overtime_minutes INTEGER DEFAULT 0,
    absence_minutes INTEGER DEFAULT 0,
    night_minutes INTEGER DEFAULT 0,
    late_minutes INTEGER DEFAULT 0,
    
    -- Flags
    is_absence BOOLEAN DEFAULT FALSE,
    is_holiday BOOLEAN DEFAULT FALSE,
    
    -- Dados brutos para referência
    raw_data JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_employee_date UNIQUE (employee_id, date),
    CONSTRAINT positive_worked CHECK (worked_minutes >= 0),
    CONSTRAINT positive_expected CHECK (expected_minutes >= 0),
    CONSTRAINT positive_overtime CHECK (overtime_minutes >= 0),
    CONSTRAINT positive_absence CHECK (absence_minutes >= 0),
    CONSTRAINT positive_night CHECK (night_minutes >= 0)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_timesheets_daily_employee ON timesheets_daily(employee_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_daily_company ON timesheets_daily(company_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_daily_date ON timesheets_daily(date);
CREATE INDEX IF NOT EXISTS idx_timesheets_daily_period ON timesheets_daily(employee_id, date);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_timesheets_daily_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_timesheets_daily_updated_at ON timesheets_daily;
CREATE TRIGGER trigger_timesheets_daily_updated_at
    BEFORE UPDATE ON timesheets_daily
    FOR EACH ROW
    EXECUTE FUNCTION update_timesheets_daily_updated_at();


-- Tabela de consolidação de pré-folha (resumos por período)
CREATE TABLE IF NOT EXISTS payroll_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    
    -- Período
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Totais em minutos
    total_worked_minutes INTEGER DEFAULT 0,
    total_expected_minutes INTEGER DEFAULT 0,
    total_overtime_minutes INTEGER DEFAULT 0,
    total_absence_minutes INTEGER DEFAULT 0,
    total_night_minutes INTEGER DEFAULT 0,
    total_late_minutes INTEGER DEFAULT 0,
    
    -- Contadores
    total_work_days INTEGER DEFAULT 0,
    total_absence_days INTEGER DEFAULT 0,
    
    -- Status
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'calculated', 'exported')),
    
    -- Metadados
    calculated_at TIMESTAMPTZ,
    exported_at TIMESTAMPTZ,
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_employee_period UNIQUE (employee_id, period_start, period_end)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_payroll_summaries_employee ON payroll_summaries(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_summaries_company ON payroll_summaries(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_summaries_period ON payroll_summaries(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_summaries_status ON payroll_summaries(status);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_payroll_summaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_payroll_summaries_updated_at ON payroll_summaries;
CREATE TRIGGER trigger_payroll_summaries_updated_at
    BEFORE UPDATE ON payroll_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_payroll_summaries_updated_at();


-- RLS: Habilitar row level security
ALTER TABLE timesheets_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_summaries ENABLE ROW LEVEL SECURITY;

-- Remover políticas existentes para evitar erro de duplicação
DROP POLICY IF EXISTS "timesheets_daily_company_isolation" ON timesheets_daily;
DROP POLICY IF EXISTS "timesheets_daily_admin_full_access" ON timesheets_daily;
DROP POLICY IF EXISTS "timesheets_daily_employee_own_data" ON timesheets_daily;
DROP POLICY IF EXISTS "timesheets_daily_company_access" ON timesheets_daily;
DROP POLICY IF EXISTS "payroll_summaries_company_isolation" ON payroll_summaries;
DROP POLICY IF EXISTS "payroll_summaries_admin_full_access" ON payroll_summaries;
DROP POLICY IF EXISTS "payroll_summaries_employee_own_data" ON payroll_summaries;
DROP POLICY IF EXISTS "payroll_summaries_company_access" ON payroll_summaries;

-- Políticas para timesheets_daily (permitir acesso se for da mesma empresa do usuário ou próprio dado)
CREATE POLICY "timesheets_daily_company_access"
    ON timesheets_daily
    FOR ALL
    TO authenticated
    USING (
        -- Permitir se for o próprio funcionário
        employee_id = auth.uid()
        OR
        -- Permitir se for admin/HR da mesma empresa
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.company_id = timesheets_daily.company_id
            AND users.role IN ('admin', 'hr')
        )
    );

-- Políticas para payroll_summaries
CREATE POLICY "payroll_summaries_company_access"
    ON payroll_summaries
    FOR ALL
    TO authenticated
    USING (
        -- Permitir se for o próprio funcionário
        employee_id = auth.uid()
        OR
        -- Permitir se for admin/HR da mesma empresa
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.company_id = payroll_summaries.company_id
            AND users.role IN ('admin', 'hr')
        )
    );

-- Grants para authenticated (para permitir acesso direto via API)
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheets_daily TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_summaries TO authenticated;
GRANT ALL ON timesheets_daily TO service_role;
GRANT ALL ON payroll_summaries TO service_role;

-- Função para calcular pré-folha de um funcionário no período
CREATE OR REPLACE FUNCTION calculate_payroll_summary(
    p_employee_id UUID,
    p_company_id TEXT,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_worked INTEGER;
    v_expected INTEGER;
    v_overtime INTEGER;
    v_absence INTEGER;
    v_night INTEGER;
    v_late INTEGER;
    v_work_days INTEGER;
    v_absence_days INTEGER;
BEGIN
    -- Calcular totais do período
    SELECT 
        COALESCE(SUM(worked_minutes), 0),
        COALESCE(SUM(expected_minutes), 0),
        COALESCE(SUM(overtime_minutes), 0),
        COALESCE(SUM(absence_minutes), 0),
        COALESCE(SUM(night_minutes), 0),
        COALESCE(SUM(late_minutes), 0),
        COUNT(*) FILTER (WHERE worked_minutes > 0),
        COUNT(*) FILTER (WHERE is_absence = TRUE)
    INTO v_worked, v_expected, v_overtime, v_absence, v_night, v_late, v_work_days, v_absence_days
    FROM timesheets_daily
    WHERE employee_id = p_employee_id
    AND company_id = p_company_id
    AND date BETWEEN p_start_date AND p_end_date;
    
    -- Montar resultado
    v_result := jsonb_build_object(
        'employee_id', p_employee_id,
        'period_start', p_start_date,
        'period_end', p_end_date,
        'total_worked_minutes', v_worked,
        'total_expected_minutes', v_expected,
        'total_overtime_minutes', v_overtime,
        'total_absence_minutes', v_absence,
        'total_night_minutes', v_night,
        'total_late_minutes', v_late,
        'total_work_days', v_work_days,
        'total_absence_days', v_absence_days,
        'worked_hours', ROUND(v_worked / 60.0, 2),
        'expected_hours', ROUND(v_expected / 60.0, 2),
        'overtime_hours', ROUND(v_overtime / 60.0, 2),
        'absence_hours', ROUND(v_absence / 60.0, 2),
        'night_hours', ROUND(v_night / 60.0, 2),
        'late_hours', ROUND(v_late / 60.0, 2)
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Função para upsert de cálculo diário
CREATE OR REPLACE FUNCTION upsert_daily_timesheet(
    p_employee_id UUID,
    p_company_id TEXT,
    p_date DATE,
    p_worked_minutes INTEGER,
    p_expected_minutes INTEGER DEFAULT 480,
    p_overtime_minutes INTEGER DEFAULT 0,
    p_absence_minutes INTEGER DEFAULT 0,
    p_night_minutes INTEGER DEFAULT 0,
    p_late_minutes INTEGER DEFAULT 0,
    p_is_absence BOOLEAN DEFAULT FALSE,
    p_raw_data JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO timesheets_daily (
        employee_id, company_id, date,
        worked_minutes, expected_minutes, overtime_minutes,
        absence_minutes, night_minutes, late_minutes,
        is_absence, raw_data
    ) VALUES (
        p_employee_id, p_company_id, p_date,
        p_worked_minutes, p_expected_minutes, p_overtime_minutes,
        p_absence_minutes, p_night_minutes, p_late_minutes,
        p_is_absence, p_raw_data
    )
    ON CONFLICT (employee_id, date) 
    DO UPDATE SET
        worked_minutes = EXCLUDED.worked_minutes,
        expected_minutes = EXCLUDED.expected_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes,
        absence_minutes = EXCLUDED.absence_minutes,
        night_minutes = EXCLUDED.night_minutes,
        late_minutes = EXCLUDED.late_minutes,
        is_absence = EXCLUDED.is_absence,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW()
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Comentários
COMMENT ON TABLE timesheets_daily IS 'Cálculos diários de jornada de trabalho (pré-folha)';
COMMENT ON TABLE payroll_summaries IS 'Consolidação de jornada por período (pré-folha)';
COMMENT ON FUNCTION calculate_payroll_summary IS 'Calcula o resumo de jornada de um funcionário no período';
COMMENT ON FUNCTION upsert_daily_timesheet IS 'Insere ou atualiza o cálculo diário de jornada';
