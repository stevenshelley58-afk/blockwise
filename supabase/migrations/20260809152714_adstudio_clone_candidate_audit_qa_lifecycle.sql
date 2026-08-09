-- A paid image must be retained before QA, including when the reviewer cannot
-- return a valid schema. Keep a separate lifecycle from the bound review.

alter table public.adstudio_clone_candidate_audits
  alter column review_json drop not null,
  add column if not exists qa_status text,
  add column if not exists qa_error text;

update public.adstudio_clone_candidate_audits
set qa_status = case when accepted then 'passed' else 'rejected' end
where qa_status is null;

alter table public.adstudio_clone_candidate_audits
  alter column qa_status set not null,
  alter column qa_status set default 'pending',
  add constraint adstudio_clone_candidate_audits_qa_status_check
    check (qa_status in ('pending', 'passed', 'rejected', 'technical_failed', 'aborted')),
  add constraint adstudio_clone_candidate_audits_accepted_matches_qa_status_check
    check (accepted = (qa_status = 'passed')),
  add constraint adstudio_clone_candidate_audits_qa_error_length_check
    check (qa_error is null or char_length(qa_error) <= 1000),
  add constraint adstudio_clone_candidate_audits_qa_state_shape_check
    check (
      (qa_status in ('passed', 'rejected') and review_json is not null and qa_error is null)
      or (qa_status = 'pending' and review_json is null and qa_error is null)
      or (qa_status in ('technical_failed', 'aborted') and review_json is null and qa_error is not null)
    );
