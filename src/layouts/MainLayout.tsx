import {
  BarChartOutlined,
  BulbOutlined,
  BuildOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileAddOutlined,
  EditOutlined,
  HomeOutlined,
  LineChartOutlined,
  PartitionOutlined,
  ProfileOutlined,
  SettingOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Layout, Menu, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import PageErrorBoundary from "../components/PageErrorBoundary";
import { APP_NAME, APP_NAME_CN } from "../lib/constants";
import { invokeOrMock } from "../lib/tauri";
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

const menuItems = [
  {
    key: "dashboard-group",
    label: "仪表盘",
    type: "group" as const,
    children: [{ key: "/dashboard", label: "仪表盘", icon: <HomeOutlined /> }]
  },
  {
    key: "database-group",
    label: "数据库",
    type: "group" as const,
    children: [
      { key: "/molecules", label: "分子库", icon: <DatabaseOutlined /> },
      { key: "/descriptors", label: "描述符中心", icon: <BarChartOutlined /> },
      { key: "/base-additive", label: "基础油/添加剂库", icon: <BuildOutlined /> },
      { key: "/formulations", label: "配方库", icon: <PartitionOutlined /> },
      { key: "/experiments", label: "实验与性能", icon: <ExperimentOutlined /> }
    ]
  },
  {
    key: "input-group",
    label: "录入",
    type: "group" as const,
    children: [
      { key: "/molecule-entry", label: "分子录入", icon: <FileAddOutlined /> },
      { key: "/molecule-sketcher", label: "分子绘画", icon: <EditOutlined /> },
      { key: "/formulation-entry", label: "配方录入", icon: <ProfileOutlined /> }
    ]
  },
  {
    key: "data-mining-group",
    label: "数据挖掘",
    type: "group" as const,
    children: [
      { key: "/data-mining/molecule-performance", label: "分子性能预测", icon: <LineChartOutlined /> },
      { key: "/data-mining/formulation-prediction", label: "配方预测", icon: <ExperimentOutlined /> },
      { key: "/data-mining/molecule-design", label: "分子设计", icon: <BulbOutlined /> }
    ]
  },
  {
    key: "system-group",
    label: "系统",
    type: "group" as const,
    children: [
      { key: "/import-export", label: "导入/导出", icon: <UploadOutlined /> },
      { key: "settings", label: "设置", icon: <SettingOutlined />, disabled: true }
    ]
  }
];

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>({
    sqlite_status: "checking",
    python_sidecar_status: "checking"
  });

  useEffect(() => {
    let cancelled = false;

    invokeOrMock<WorkspaceStatusResponse>("get_workspace_status", {}, async () => ({
      data: {
        workspace_path: "LMD_Workspace",
        sqlite_status: "unavailable",
        python_sidecar_status: "mock"
      }
    }))
      .then((response) => {
        if (!cancelled) setWorkspaceStatus(response.data ?? {});
      })
      .catch((error) => {
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
        trigger={null}
        className={styles.appSider}
      >
        <div className={styles.brandBlock}>
          <img className={styles.brandLogo} src="/logo.svg" alt="LMD logo" />
          <div>
            <Typography.Text className={styles.brandTitle}>{APP_NAME}</Typography.Text>
            <Typography.Text className={styles.brandSubtitle}>{APP_NAME_CN}</Typography.Text>
          </div>
        </div>
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => {
            if (String(key).startsWith("/")) navigate(String(key));
          }}
        />
      </Sider>
      <Layout className={styles.appMain}>
        <Header className={styles.appHeader}>
          <div>
            <Typography.Title level={4}>{APP_NAME}</Typography.Title>
            <Typography.Text type="secondary">本地润滑材料数据库与智能设计 MVP</Typography.Text>
          </div>
        </Header>
        <Content className={styles.appContent}>
          <PageErrorBoundary>
            <Outlet />
          </PageErrorBoundary>
        </Content>
        <Footer className={styles.statusFooter}>
          <Space size="middle" wrap>
            <span>工作区：{workspaceStatus.workspace_path ?? "LMD_Workspace"}</span>
            <Tag color={sqliteReady ? "green" : "red"}>{sqliteReady ? "SQLite 就绪" : "SQLite 未就绪"}</Tag>
            <Tag color={sidecarTagColor(sidecarStatus)} title={workspaceStatus.python_sidecar_error ?? undefined}>
              {sidecarTagText(sidecarStatus)}
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

function sidecarTagText(status: WorkspaceStatus["python_sidecar_status"]) {
  if (status === "real") return "Python Sidecar 真实模式";
  if (status === "mock") return "Python Sidecar 模拟模式";
  if (status === "unavailable") return "Python Sidecar 不可用";
  return "Python Sidecar 检查中";
}
