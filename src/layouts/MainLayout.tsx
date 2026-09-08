import {
  BarChartOutlined,
  BuildOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileAddOutlined,
  EditOutlined,
  HomeOutlined,
  LineChartOutlined,
  PartitionOutlined,
  SettingOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Layout, Menu, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import PageErrorBoundary from "../components/PageErrorBoundary";
import PagedContent from "../components/PagedContent";
import { APP_NAME } from "../lib/constants";
import { useLanguage, type MessageKey } from "../i18n/LanguageContext";
import { invokeCommand, isDemoMode, isTauriRuntime } from "../lib/tauri";
import styles from "./MainLayout.module.css";

const { Header, Sider, Content, Footer } = Layout;

type WorkspaceStatus = {
  workspace_path?: string;
  database_path?: string;
  sqlite_status?: string;
  python_sidecar_status?: "checking" | "real" | "mock" | "unavailable";
  python_sidecar_error?: string | null;
};

type WorkspaceStatusResponse = {
  data?: WorkspaceStatus;
};

const createMenuItems = (t: (key: MessageKey) => string) => [
  {
    key: "dashboard-group",
    label: t("menu.dashboardGroup"),
    type: "group" as const,
    children: [{ key: "/dashboard", label: t("menu.dashboard"), icon: <HomeOutlined /> }]
  },
  {
    key: "database-group",
    label: t("menu.database"),
    type: "group" as const,
    children: [
      { key: "/molecules", label: t("menu.molecules"), icon: <DatabaseOutlined /> },
      { key: "/products", label: t("menu.products"), icon: <BuildOutlined /> },
      { key: "/descriptors", label: t("menu.descriptors"), icon: <BarChartOutlined /> },
      { key: "/base-additive", label: t("menu.baseAdditive"), icon: <BuildOutlined /> },
      { key: "/formulations", label: t("menu.formulations"), icon: <PartitionOutlined /> },
      { key: "/experiments", label: t("menu.experiments"), icon: <ExperimentOutlined /> }
    ]
  },
  {
    key: "input-group",
    label: t("menu.input"),
    type: "group" as const,
    children: [
      { key: "/molecule-entry", label: t("menu.moleculeEntry"), icon: <FileAddOutlined /> },
      { key: "/molecule-sketcher", label: t("menu.moleculeSketcher"), icon: <EditOutlined /> },
    ]
  },
  {
    key: "data-mining-group",
    label: t("menu.dataMining"),
    type: "group" as const,
    children: [
      { key: "/data-mining/molecule-performance", label: t("menu.moleculePerformance"), icon: <LineChartOutlined /> },
      { key: "/data-mining/formulation-prediction", label: t("menu.formulationPrediction"), icon: <ExperimentOutlined /> },
      { key: "/data-mining/molecule-design", label: t("menu.molecularDesign"), icon: <ClusterOutlined /> }
    ]
  },
  {
    key: "system-group",
    label: t("menu.system"),
    type: "group" as const,
    children: [
      { key: "/import-export", label: t("menu.importExport"), icon: <UploadOutlined /> },
      { key: "/settings", label: t("menu.settings"), icon: <SettingOutlined /> }
    ]
  }
];

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const menuItems = useMemo(() => createMenuItems(t), [t]);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>({
    sqlite_status: "checking",
    python_sidecar_status: "checking"
  });

  useEffect(() => {
    let cancelled = false;

    invokeCommand<WorkspaceStatusResponse>("get_workspace_status", {})
      .then((response: WorkspaceStatusResponse) => {
        if (!cancelled) setWorkspaceStatus(response.data ?? {});
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWorkspaceStatus({
            sqlite_status: "unavailable",
            python_sidecar_status: "unavailable",
            python_sidecar_error: error instanceof Error ? error.message : String(error)
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const sqliteReady = workspaceStatus.sqlite_status === "ready";
  const sidecarStatus = workspaceStatus.python_sidecar_status ?? "checking";

  return (
    <Layout className={styles.mainLayout}>
      <Sider
        width={288}
        collapsedWidth={72}
        breakpoint="lg"
        collapsible
        className={styles.appSider}
      >
        <div className={styles.brandBlock}>
          <img className={styles.brandLogo} src="/logo.png" alt={t("ui.lmdLogo")} />
          <div>
            <Typography.Text className={styles.brandTitle}>{APP_NAME}</Typography.Text>
          </div>
        </div>
        <div className={styles.menuViewport}>
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[location.pathname.startsWith("/formulations/") ? "/formulations" : location.pathname]}
            items={menuItems}
            onClick={({ key }) => {
              if (String(key).startsWith("/")) navigate(String(key));
            }}
          />
        </div>
      </Sider>
      <Layout className={styles.appMain}>
        <Header className={styles.appHeader}>
          <div>
            <Typography.Title level={4}>{APP_NAME}</Typography.Title>
            <Typography.Text type="secondary">{t("app.subtitle")}</Typography.Text>
          </div>
          {/* Two different states, and conflating them is how a broken desktop build starts
              looking like a demo. Demo mode is labelled; a browser with no demo flag is told that
              its data operations will be refused. */}
          {isDemoMode() ? (
            <Tag color="gold" className={styles.mockModeTag}>{t("status.browserMockMode")}</Tag>
          ) : !isTauriRuntime() ? (
            <Tag color="red" className={styles.mockModeTag}>{t("status.desktopOnlyMode")}</Tag>
          ) : null}
        </Header>
        <Content className={styles.appContent}>
          {["/experiments", "/formulations/new", "/molecule-entry", "/molecule-sketcher", "/data-mining/molecule-performance", "/data-mining/formulation-prediction"].includes(location.pathname) ? (
            <div className="workspace-fixed-panel">
              <PageErrorBoundary><Outlet /></PageErrorBoundary>
            </div>
          ) : <PagedContent key={location.pathname}>
            <PageErrorBoundary>
              <Outlet />
            </PageErrorBoundary>
          </PagedContent>}
        </Content>
        <Footer className={styles.statusFooter}>
          <Space size="middle">
            <span className={styles.workspacePath} title={workspaceStatus.workspace_path}>
              {t("status.workspace")}：
              {/* i18n-exempt: a directory name on disk, shown verbatim. */}
              <span translate="no">{workspaceStatus.workspace_path ?? "LMD_Workspace"}</span>
            </span>
            <Tag color={sqliteReady ? "green" : "red"}>{sqliteReady ? t("status.sqliteReady") : t("status.sqliteUnavailable")}</Tag>
            <Tag color={sidecarTagColor(sidecarStatus)} title={workspaceStatus.python_sidecar_error ?? undefined}>
              {sidecarTagText(sidecarStatus, t)}
            </Tag>
          </Space>
        </Footer>
      </Layout>
    </Layout>
  );
}

function sidecarTagColor(status: WorkspaceStatus["python_sidecar_status"]) {
  if (status === "real") return "green";
  if (status === "mock") return "gold";
  if (status === "unavailable") return "red";
  return "processing";
}

function sidecarTagText(status: WorkspaceStatus["python_sidecar_status"], t: (key: MessageKey) => string) {
  if (status === "real") return t("status.sidecarReal");
  if (status === "mock") return t("status.sidecarMock");
  if (status === "unavailable") return t("status.sidecarUnavailable");
  return t("status.sidecarChecking");
}
