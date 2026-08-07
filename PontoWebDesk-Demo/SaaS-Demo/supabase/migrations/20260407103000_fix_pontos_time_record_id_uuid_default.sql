create extension if not exists "pgcrypto";

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pontos'
      and column_name = 'time_record_id'
  ) then
    execute $sql$
      alter table public.pontos
      alter column time_record_id type uuid
      using (
        case
          when time_record_id is null then gen_random_uuid()
          when time_record_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then time_record_id::text::uuid
          else gen_random_uuid()
        end
      )
    $sql$;
    execute 'alter table public.pontos alter column time_record_id set default gen_random_uuid()';
  end if;
end
$$;
