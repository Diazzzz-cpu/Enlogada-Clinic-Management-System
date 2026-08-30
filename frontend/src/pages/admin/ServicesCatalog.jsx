import React from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import PageHeader from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Layers, Plus } from 'lucide-react';
import ServicesTablePanel from '../../components/admin/ServicesTablePanel';
import ServiceFormDialog from '../../components/admin/ServiceFormDialog';
import HmoProvidersPanel from '../../components/admin/HmoProvidersPanel';
import PackagesPanel from '../../components/admin/PackagesPanel';
import PackageFormDialog from '../../components/admin/PackageFormDialog';
import HmoProviderFormDialog from '../../components/admin/HmoProviderFormDialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { useTestCatalogue } from '../../hooks/useTestCatalogue';
import { useHmoProviderAdmin } from '../../hooks/useHmoProviderAdmin';
import { usePackageAdmin } from '../../hooks/usePackageAdmin';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';

/**
 * What the clinic sells, and who it bills.
 *
 * Two independent administrations that share a screen because an admin doing one is usually
 * about to do the other. They have a hook and a panel each; this wires them together.
 */
const ServicesCatalog = ({ activeNav = 'services-cat', onSelectNav }) => {
  const catalogue = useTestCatalogue();
  const hmoAdmin = useHmoProviderAdmin();
  const packageAdmin = usePackageAdmin();

  // One control, three lists. It used to reload only the services, so a package or a provider
  // added by someone else stayed missing from a screen the reader had just deliberately
  // refreshed — which is worse than no button, because it answers the question wrongly.
  const anyLoading = catalogue.loading || packageAdmin.loading || hmoAdmin.loading;
  const anyError = catalogue.error || packageAdmin.error || hmoAdmin.error;
  const updatedAt = useFreshness(anyLoading, anyError);
  const reloadAll = () => {
    catalogue.reload();
    packageAdmin.reload();
    hmoAdmin.reload();
  };

  return (
    <SidebarLayout title="Services Catalog Management" activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-6">

        <PageHeader
          eyebrow="Administration"
          icon={Layers}
          title="Clinic Services & Price Catalog"
          description="The diagnostic services the clinic offers and what they cost. Edits appear immediately on the public website and in the patient booking form."
          actions={
            <>
              <RefreshButton onRefresh={reloadAll} loading={anyLoading} updatedAt={updatedAt} />
              <Button onClick={catalogue.openAdd}>
                <Plus className="h-4 w-4" />
                Add New Service
              </Button>
            </>
          }
        />

        <ServicesTablePanel catalogue={catalogue} />
        <PackagesPanel packageAdmin={packageAdmin} />
        <HmoProvidersPanel hmoAdmin={hmoAdmin} />

        <PackageFormDialog packageAdmin={packageAdmin} />
        <ConfirmDialog
          open={!!packageAdmin.confirmTarget}
          onOpenChange={(open) => { if (!open) packageAdmin.dismissToggle(); }}
          title={packageAdmin.confirmTarget?.isActive ? 'Retire Package' : 'Offer Package Again'}
          description={packageAdmin.confirmTarget && (
            packageAdmin.confirmTarget.isActive
              ? `Stop offering "${packageAdmin.confirmTarget.name}"? It disappears from the public price list and the booking form immediately. Visits already booked against it are untouched and keep their price.`
              : `Offer "${packageAdmin.confirmTarget.name}" again? It reappears on the public price list and the booking form.`
          )}
          confirmLabel={packageAdmin.confirmTarget?.isActive ? 'Retire' : 'Offer again'}
          onConfirm={packageAdmin.confirmToggle}
          loading={packageAdmin.toggling}
          error={packageAdmin.toggleError}
        />

        <HmoProviderFormDialog hmoAdmin={hmoAdmin} />
        <ConfirmDialog
          open={!!hmoAdmin.confirmTarget}
          onOpenChange={(open) => { if (!open) hmoAdmin.dismissToggle(); }}
          title={hmoAdmin.confirmTarget?.is_active ? 'Deactivate Provider' : 'Activate Provider'}
          description={hmoAdmin.confirmTarget && (
            `${hmoAdmin.confirmTarget.is_active ? 'Deactivate' : 'Activate'} "${hmoAdmin.confirmTarget.name}"? ${hmoAdmin.confirmTarget.is_active ? 'Existing HMO requests are unaffected, but staff will be warned this provider is no longer accredited.' : ''}`
          )}
          confirmLabel={hmoAdmin.confirmTarget?.is_active ? 'Deactivate' : 'Activate'}
          onConfirm={hmoAdmin.confirmToggle}
          loading={hmoAdmin.toggling}
          error={hmoAdmin.toggleError}
        />

        <ServiceFormDialog catalogue={catalogue} />
        <ConfirmDialog
          open={!!catalogue.confirmTarget}
          onOpenChange={(open) => { if (!open) catalogue.dismissToggle(); }}
          title={catalogue.confirmTarget?.is_active ? 'Deactivate Service' : 'Activate Service'}
          description={catalogue.confirmTarget && (
            `Are you sure you want to change "${catalogue.confirmTarget.name}" from ${catalogue.confirmTarget.is_active ? 'Active' : 'Inactive'} to ${catalogue.confirmTarget.is_active ? 'Inactive' : 'Active'}? This immediately affects its availability on the public booking form.`
          )}
          confirmLabel={catalogue.confirmTarget?.is_active ? 'Deactivate' : 'Activate'}
          onConfirm={catalogue.confirmToggle}
          loading={catalogue.toggling}
          error={catalogue.toggleError}
        />

      </div>
    </SidebarLayout>
  );
};

export default ServicesCatalog;
