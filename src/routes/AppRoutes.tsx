import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import PageErrorBoundary from "../components/PageErrorBoundary";
import LoadingBlock from "../components/LoadingBlock";

/**
 * Every feature page is loaded on demand.
 *
 * The sketcher, charts, model workbench and tables load only when their page is opened.
 *
 * These are ordinary `import()` calls, so Vite emits one chunk per page and each is read from the
 * application's own bundle. Nothing here reaches the network.
 */
const DashboardPage = lazy(() => import("../features/dashboard/DashboardPage"));
const MoleculeLibraryPage = lazy(() => import("../features/molecules/MoleculeLibraryPage"));
const MoleculeEntryPage = lazy(() => import("../features/molecule-entry/MoleculeEntryPage"));
const MoleculeSketcherPage = lazy(() => import("../features/molecule-sketcher/MoleculeSketcherPage"));
const CommercialProductLibraryPage = lazy(() => import("../features/commercial-products/CommercialProductLibraryPage"));
const DescriptorCenterPage = lazy(() => import("../features/descriptors/DescriptorCenterPage"));
const BaseAdditiveLibraryPage = lazy(() => import("../features/base-additive/BaseAdditiveLibraryPage"));
const FormulationLibraryPage = lazy(() => import("../features/formulations/FormulationLibraryPage"));
const FormulationEntryPage = lazy(() => import("../features/formulations/FormulationEntryPage"));
const ExperimentPerformancePage = lazy(() => import("../features/experiments/ExperimentPerformancePage"));
const ImportExportPage = lazy(() => import("../features/import-export/ImportExportPage"));
const MoleculePerformancePredictionPage = lazy(
  () => import("../features/data-mining/MoleculePerformancePredictionPage")
);
const FormulationPredictionPage = lazy(() => import("../features/data-mining/FormulationPredictionPage"));
const MolecularDesignPage = lazy(() => import("../features/molecular-design/MolecularDesignPage"));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage"));

/**
 * The shared wrapper: a boundary that catches a render failure and a fallback that says something.
 *
 * The fallback carries `role="status"` through `LoadingBlock`, so a screen reader announces that
 * the page is arriving rather than reading an empty document.
 */
function LazyPage({ children }: { children: ReactNode }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<LoadingBlock />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}

/** Wraps one lazily-loaded page so each route reads as one line. */
function page(Component: ComponentType) {
  return (
    <LazyPage>
      <Component />
    </LazyPage>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard" element={page(DashboardPage)} />
      <Route path="/molecules" element={page(MoleculeLibraryPage)} />
      <Route path="/products" element={page(CommercialProductLibraryPage)} />
      <Route path="/molecule-entry" element={page(MoleculeEntryPage)} />
      <Route path="/molecule-sketcher" element={page(MoleculeSketcherPage)} />
      <Route path="/descriptors" element={page(DescriptorCenterPage)} />
      <Route path="/base-additive" element={page(BaseAdditiveLibraryPage)} />
      <Route path="/formulations" element={page(FormulationLibraryPage)} />
      <Route path="/formulations/new" element={page(FormulationEntryPage)} />
      <Route path="/formulation-entry" element={<Navigate to="/formulations/new" replace />} />
      <Route path="/experiments" element={page(ExperimentPerformancePage)} />
      <Route path="/data-mining/molecule-performance" element={page(MoleculePerformancePredictionPage)} />
      <Route path="/data-mining/formulation-prediction" element={page(FormulationPredictionPage)} />
      <Route path="/data-mining/molecule-design" element={page(MolecularDesignPage)} />
      <Route path="/import-export" element={page(ImportExportPage)} />
      <Route path="/settings" element={page(SettingsPage)} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
