-- Supabase Auth scans these legacy token fields as strings. A NULL value in
-- any of them can break Auth Admin user enumeration with:
-- "Database error finding users".
--
-- The hosted Auth schema is owned by supabase_auth_admin, so project
-- migrations can repair the data but must not alter the managed table
-- definition.
do $$
begin
  update auth.users
  set confirmation_token = coalesce(confirmation_token, ''),
      recovery_token = coalesce(recovery_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      updated_at = now()
  where confirmation_token is null
     or recovery_token is null
     or email_change is null
     or email_change_token_new is null;
end $$;
