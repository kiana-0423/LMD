import { lazy, Suspense } from "react";
import LoadingBlock from "./components/LoadingBlock";
import type {} from "./lib/modelExplanationApi";
import { Navigate, Route, Routes } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";
import AppRoutes from "./routes/AppRoutes";

const ModelExplanationWindow = lazy(() => import("./features/data-mining/ModelExplanationWindow"));

export default function App() {
  if (window.__LMD_EXPLANATION__) {
    return <Suspense fallback={<LoadingBlock />}><ModelExplanationWindow request={window.__LMD_EXPLANATION__} /></Suspense>;
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/*" element={<AppRoutes />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
