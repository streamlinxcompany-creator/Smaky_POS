-- Smaky POS: guardar el PIN del POS para que el gerente pueda
-- administrarlo desde Configuraciones > Usuarios.
-- Supabase Auth sigue usando su contraseña interna (hash); este campo
-- corresponde exclusivamente al PIN de 4 dígitos del POS.
alter table public.profiles
  add column if not exists pin text;

alter table public.profiles
  drop constraint if exists profiles_pin_format;

alter table public.profiles
  add constraint profiles_pin_format
  check (pin is null or pin ~ '^\d{4}$');

comment on column public.profiles.pin is
  'PIN de 4 dígitos del POS. Se entrega únicamente mediante la función administrativa al gerente.';
