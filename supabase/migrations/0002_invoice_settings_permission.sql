-- Permite delegar exclusivamente la configuración del comprobante.
-- La política conserva el control total de gerentes y administradores.
drop policy if exists settings_insert on public.settings;
drop policy if exists settings_update on public.settings;

create policy settings_insert on public.settings for insert to authenticated
with check (
  (select private.is_active_user())
  and (
    (select private.is_manager_or_admin())
    or (key = 'generalSettings' and ((select private.has_permission('settings.general')) or (select private.has_permission('invoice.settings'))))
    or (key = 'orderFields' and (select private.has_permission('settings.orders')))
    or (key = 'paymentMethods' and (select private.has_permission('settings.payments')))
    or (key = 'productCategories' and (select private.has_permission('settings.categories')))
  )
);

create policy settings_update on public.settings for update to authenticated
using (
  (select private.is_active_user())
  and (
    (select private.is_manager_or_admin())
    or (key = 'generalSettings' and ((select private.has_permission('settings.general')) or (select private.has_permission('invoice.settings'))))
    or (key = 'orderFields' and (select private.has_permission('settings.orders')))
    or (key = 'paymentMethods' and (select private.has_permission('settings.payments')))
    or (key = 'productCategories' and (select private.has_permission('settings.categories')))
  )
)
with check (
  (select private.is_active_user())
  and (
    (select private.is_manager_or_admin())
    or (key = 'generalSettings' and ((select private.has_permission('settings.general')) or (select private.has_permission('invoice.settings'))))
    or (key = 'orderFields' and (select private.has_permission('settings.orders')))
    or (key = 'paymentMethods' and (select private.has_permission('settings.payments')))
    or (key = 'productCategories' and (select private.has_permission('settings.categories')))
  )
);
