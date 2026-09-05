import PagedDrawer from "../../components/PagedDrawer";
import { Descriptions, Input, Select, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import type { DesignCandidate, VerificationStatus } from "../../lib/api";
import { chemicalClassLabelKeys, substituentTypeLabelKeys, VERIFICATION_STATUSES, verificationLabelKeys } from "../../lib/designPolicy";

/**
 * Everything recorded about one candidate: structure, provenance, validation, and the
 * experimental verification status — the one field a person edits here, because it is the one
 * fact a person supplies.
 */
export default function CandidateDetailDrawer({
  candidate,
  onClose,
  onVerification
}: {
  candidate?: DesignCandidate;
  onClose: () => void;
  onVerification: (candidate: DesignCandidate, status: VerificationStatus, notes: string) => void;
}) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setNotes(candidate?.verificationNotes ?? "");
  }, [candidate]);
  if (!candidate) return <PagedDrawer open={false} onClose={onClose} />;
  return (
    <PagedDrawer open width={720} onClose={onClose} title={<span translate="no">{candidate.name}</span>}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {candidate.structureSvg ? (
          <img
            style={{ width: 320, height: 200, objectFit: "contain" }}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(candidate.structureSvg)}`}
            alt={t("ui.2dMolecularStructure")}
          />
        ) : null}
        <Descriptions size="small" bordered column={1}>
          <Descriptions.Item label={t("ui.canonicalSmilesLabel")}>
            <span translate="no">{candidate.smilesCanonical}</span>
          </Descriptions.Item>
          <Descriptions.Item label={t("ui.inchiKeyLabel")}>
            <span translate="no">{candidate.inchiKey}</span>
          </Descriptions.Item>
          <Descriptions.Item label={t("design.formula")}>
            <span translate="no">{candidate.formula}</span>
          </Descriptions.Item>
          <Descriptions.Item label={t("design.chemicalClasses")}>
            <Space size={2} wrap>
              {candidate.chemicalClasses.map((label) => (
                <Tag key={label}>{chemicalClassLabelKeys[label] ? t(chemicalClassLabelKeys[label]) : <span translate="no">{label}</span>}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={t(candidate.templateId ? "design.substituents" : "design.fragmentsCollected")}>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {candidate.substituents.map((substituent) => (
                <li key={substituent.position}>
                  <span translate="no">
                    {candidate.templateId ? "R" : "#"}{substituent.position}: {substituent.name} ({substituent.smiles})
                  </span>{" "}
                  — {substituentTypeLabelKeys[substituent.type] ? t(substituentTypeLabelKeys[substituent.type]) : <span translate="no">{substituent.type}</span>} —{" "}
                  {t("design.substituentSource")}: <span translate="no">{substituent.source}{substituent.sourceId || substituent.source_id ? ` (${substituent.sourceId ?? substituent.source_id})` : ""}</span>
                </li>
              ))}
            </ul>
          </Descriptions.Item>
          <Descriptions.Item label={t("design.provenance")}>
            <Space direction="vertical" size={2}>
              <span>
                {t("design.template")}: <span translate="no">{candidate.templateId || t("design.noTemplate")}</span>
              </span>
              <span>
                {t("design.generatorVersion")}: <span translate="no">{candidate.generatorVersion}</span>
              </span>
              <span>
                {t("design.randomSeed")}: <span translate="no">{candidate.randomSeed ?? "-"}</span>
              </span>
              <span>
                {t("design.seeds")}: <span translate="no">{candidate.seedIds.length ? candidate.seedIds.join(", ") : "-"}</span>
              </span>
              <span>
                {t("design.generationJob")}: <span translate="no">{candidate.jobId}</span>
              </span>
              <span>
                {t("design.generatedAt")}: <span translate="no">{candidate.createdAt}</span>
              </span>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={t("design.parameters")}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }} translate="no">
              {JSON.stringify(candidate.parameters, null, 1)}
            </pre>
          </Descriptions.Item>
          <Descriptions.Item label={t("design.validationFindings")}>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {candidate.validation.findings.map((finding) => (
                <li key={finding.rule}>
                  <Tag color={finding.ok ? "green" : "red"} translate="no">
                    {finding.rule}
                  </Tag>{" "}
                  <span translate="no">{finding.detail}</span>
                </li>
              ))}
            </ul>
          </Descriptions.Item>
          <Descriptions.Item label={t("design.libraryStatus")}>
            {candidate.promotedMoleculeId ? (
              <span>
                {t("design.promoted")}: <span translate="no">{candidate.promotedMoleculeId}</span>
              </span>
            ) : candidate.existingMoleculeId ? (
              <span>
                {t("design.alreadyInLibrary")}: <span translate="no">{candidate.existingMoleculeName}</span>
              </span>
            ) : (
              <span>{t("design.notInWorkspaceHelp")}</span>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t("design.synthesisFeasibility")}>{t("design.synthesisNotAssessedHelp")}</Descriptions.Item>
          <Descriptions.Item label={t("design.verificationStatus")}>
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              <Select
                style={{ width: 240 }}
                value={candidate.verificationStatus}
                aria-label={t("design.verificationStatus")}
                onChange={(value) => onVerification(candidate, value, notes)}
                options={VERIFICATION_STATUSES.map((status) => ({ value: status, label: t(verificationLabelKeys[status]) }))}
              />
              <Input.TextArea
                rows={2}
                value={notes}
                placeholder={t("design.verificationNotes")}
                aria-label={t("design.verificationNotes")}
                onChange={(event) => setNotes(event.target.value)}
                onBlur={() => {
                  if (notes !== candidate.verificationNotes) onVerification(candidate, candidate.verificationStatus, notes);
                }}
              />
              <Typography.Text type="secondary">{t("design.verificationHelp")}</Typography.Text>
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Space>
    </PagedDrawer>
  );
}
