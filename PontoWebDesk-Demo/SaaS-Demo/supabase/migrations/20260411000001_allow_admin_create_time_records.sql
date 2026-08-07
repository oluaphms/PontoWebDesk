-- Allow admin/HR to create time_records for employees (punch requests)
-- When an admin/HR adds a punch on behalf of an employee, they need INSERT permission
-- The RLS policy "Users can create own records" only allows creating for themselves

DROP POLICY IF EXISTS "Admin can create company records" ON public.time_records;
CREATE POLICY "Admin can create company records" ON public.time_records
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Admin/HR can create records for employees in their company
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT company_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

-- Also allow for point_receipts table
DROP POLICY IF EXISTS "Admin can create point_receipts" ON public.point_receipts;
CREATE POLICY "Admin can create point_receipts" ON public.point_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT company_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

COMMENT ON POLICY "Admin can create company records" ON public.time_records 
  IS 'Allow admin/HR to create punch records for employees (punch requests)';

COMMENT ON POLICY "Admin can create point_receipts" ON public.point_receipts 
  IS 'Allow admin/HR to create point receipts for employees';
