-- Keep persisted model logos aligned with the frontend catalog.
update public.models
set logo_url = '/logos/models/thinking-machines.webp'
where id = 'inkling';

update public.models
set logo_url = '/logos/models/prismml.jpg'
where id in ('bonsai-27b', 'bonsai-2-27b');
