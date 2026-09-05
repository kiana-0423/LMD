import PagedDrawer from "../../components/PagedDrawer";
import { Tabs } from "antd";
import { useLanguage } from "../../i18n/LanguageContext";
import type { Molecule } from "../../types";
import FormulationUsageTable from "./components/FormulationUsageTable";
import MoleculeDescriptorSummary from "./components/MoleculeDescriptorSummary";
import MoleculeDesignNotesPanel from "./components/MoleculeDesignNotesPanel";
import MoleculePropertyPanel from "./components/MoleculePropertyPanel";
import MoleculeViewer2D from "./components/MoleculeViewer2D";
import MoleculeViewer3D from "./components/MoleculeViewer3D";
import MoleculeFilesPanel from "./components/MoleculeFilesPanel";

export default function MoleculeDetailDrawer({
  molecule,
  open,
  onClose,
  onGenerated
}: {
  molecule?: Molecule;
  open: boolean;
  onClose: () => void;
  /**
   * Called with the refreshed record after a 3D structure is generated and stored.
   *
   * Without this the drawer would keep showing the record it opened with, so the Files panel and
   * the library behind it would still describe a molecule that has no structure — until the user
   * reopened them and discovered otherwise.
   */
  onGenerated?: (molecule: Molecule) => void;
}) {
  const { t } = useLanguage();
  if (!molecule) return null;

  return (
    <PagedDrawer width={760} title={<span translate="no">{molecule.name}</span>} open={open} onClose={onClose} destroyOnClose>
      <Tabs
        className="molecule-detail-tabs"
        items={[
          { key: "overview", label: t("molecule.tabOverview"), children: <MoleculePropertyPanel molecule={molecule} /> },
          { key: "2d", label: t("molecule.tab2d"), children: <MoleculeViewer2D molecule={molecule} /> },
          {
            key: "3d",
            label: t("molecule.tab3d"),
            children: <MoleculeViewer3D molecule={molecule} onGenerated={onGenerated} />
          },
          {
            key: "descriptors",
            label: t("molecule.tabDescriptors"),
            children: <MoleculeDescriptorSummary molecule={molecule} />
          },
          {
            key: "formulations",
            label: t("molecule.tabFormulations"),
            // The tab body is only mounted when opened, so the query runs on demand.
            children: <FormulationUsageTable moleculeId={molecule.id} />
          },
          {
            key: "files",
            label: t("molecule.tabFiles"),
            // Keyed on the stored structure paths: generating a structure changes them, which
            // remounts the panel so it lists the new files instead of the previous ones.
            children: (
              <MoleculeFilesPanel
                key={`${molecule.molFilePath ?? ""}|${molecule.sdfFilePath ?? ""}|${molecule.pdbFilePath ?? ""}`}
                molecule={molecule}
              />
            )
          },
          { key: "notes", label: t("molecule.tabNotes"), children: <MoleculeDesignNotesPanel molecule={molecule} /> }
        ]}
      />
    </PagedDrawer>
  );
}
