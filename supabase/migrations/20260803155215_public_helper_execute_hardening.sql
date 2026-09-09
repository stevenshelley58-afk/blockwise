revoke execute on function public.is_operator() from public, anon;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_operator() to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
