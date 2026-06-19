import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Card, Typography } from "antd";
import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "../features/dashboard/DashboardPage";
import MoleculeLibraryPage from "../features/molecules/MoleculeLibraryPage";
import MoleculeEntryPage from "../features/molecule-entry/MoleculeEntryPage";
import DescriptorCenterPage from "../features/descriptors/DescriptorCenterPage";
import BaseAdditiveLibraryPage from "../features/base-additive/BaseAdditiveLibraryPage";
import FormulationLibraryPage from "../features/formulations/FormulationLibraryPage";
import FormulationEntryPage from "../features/formulation-entry/FormulationEntryPage";
import ExperimentPerformancePage from "../features/experiments/ExperimentPerformancePage";
import ImportExportPage from "../features/import-export/ImportExportPage";
import FormulationPredictionPage from "../features/data-mining/FormulationPredictionPage";
import MoleculeDesignPage from "../features/data-mining/MoleculeDesignPage";
import MoleculePerformancePredictionPage from "../features/data-mining/MoleculePerformancePredictionPage";
import LoadingBlock from "../components/LoadingBlock";

const MoleculeSketcherPage = lazy(() => import("../features/molecule-sketcher/MoleculeSketcherPage"));

class PageErrorBoundary extends Component<{ children: ReactNode }, { errorText: string }> {
  state = { errorText: "" };

  static getDerivedStateFromError(error: unknown) {
    return { errorText: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.errorText) {
      return (
        <Card className="error-panel">
          <Typography.Title level={4}>页面加载失败</Typography.Title>
          <Typography.Paragraph>{this.state.errorText}</Typography.Paragraph>
        </Card>
      );
    }
    return this.props.children;
  }
}

function LazyPage({ children }: { children: ReactNode }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<LoadingBlock />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/molecules" element={<MoleculeLibraryPage />} />
      <Route path="/molecule-entry" element={<MoleculeEntryPage />} />
      <Route
        path="/molecule-sketcher"
        element={
          <LazyPage>
            <MoleculeSketcherPage />
          </LazyPage>
        }
      />
      <Route path="/descriptors" element={<DescriptorCenterPage />} />
      <Route path="/base-additive" element={<BaseAdditiveLibraryPage />} />
      <Route path="/formulations" element={<FormulationLibraryPage />} />
      <Route path="/formulation-entry" element={<FormulationEntryPage />} />
      <Route path="/experiments" element={<ExperimentPerformancePage />} />
      <Route path="/analysis-design" element={<Navigate to="/data-mining/molecule-performance" replace />} />
      <Route path="/data-mining/molecule-performance" element={<MoleculePerformancePredictionPage />} />
      <Route path="/data-mining/formulation-prediction" element={<FormulationPredictionPage />} />
      <Route path="/data-mining/molecule-design" element={<MoleculeDesignPage />} />
      <Route path="/import-export" element={<ImportExportPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
