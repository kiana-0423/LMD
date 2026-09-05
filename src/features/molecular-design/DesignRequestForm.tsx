import CandidateConstraintsForm from "./CandidateConstraintsForm";
import { useState } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Select, Space, Tabs, Tag, Typography } from "antd";
import { useLanguage } from "../../i18n/LanguageContext";
import MoleculePicker from "../../components/MoleculePicker";
import type { ApplicationContext, DesignTemplateCatalogue, SeedRequest } from "../../lib/api";
import { additiveFunctionLabelKeys, additiveFunctionTags } from "../../lib/constants";
import { CONCENTRATION_UNITS } from "../../lib/concentrationPolicy";
import {
  LOAD_UNITS,
  SELECTABLE_ELEMENTS,
  SUBSTITUENT_SOURCES,
  SUBSTITUENT_TYPES,
  TEMPERATURE_UNITS,
  substituentSourceLabelKeys,
  substituentTypeLabelKeys,
  templateLabelKeys
} from "../../lib/designPolicy";
import type { BaseOil } from "../../types";
import type { ChemicalClassState, TargetState } from "./designRequest";

/**
 * The three independent request dimensions, edited through named categories.
 *
 * The chemical class decides what may be generated; the target function is what the designer is
 * looking for and is recorded as intent; the application context is where the candidate would be
 * used. They are edited separately because they are separate questions — and because a control
 * that is not part of the selected template is not shown at all.
 */
export default function DesignRequestForm({
  catalogue,
  catalogueError,
  chemicalClass,
  onChemicalClass,
  target,
  onTarget,
  context,
  onContext,
  metrics,
  baseOils,
  testTypes
}: {
  catalogue?: DesignTemplateCatalogue;
  catalogueError?: { summary: string; detail: string };
  chemicalClass: ChemicalClassState;
  onChemicalClass: (next: ChemicalClassState) => void;
  target: TargetState;
  onTarget: (next: TargetState) => void;
  context: ApplicationContext;
  onContext: (next: ApplicationContext) => void;
  metrics: { column: string; label: string }[];
  baseOils: BaseOil[];
  testTypes: string[];
}) {
  const { t } = useLanguage();
  const [selectedSeed, setSelectedSeed] = useState(0);
  const activeSeed = Math.max(0, Math.min(selectedSeed, chemicalClass.seeds.length - 1));
  const template = catalogue?.templates.find((item) => item.id === chemicalClass.templateId);
  const maxCandidates = catalogue?.limits.maxCandidates ?? 500;
  const maxSeeds = catalogue?.limits.maxSeeds ?? 25;

  function setConstraint<K extends keyof ChemicalClassState["constraints"]>(
    key: K,
    value: ChemicalClassState["constraints"][K]
  ) {
    onChemicalClass({ ...chemicalClass, constraints: { ...chemicalClass.constraints, [key]: value } });
  }

  function setSeed(index: number, seed: SeedRequest) {
    onChemicalClass({
      ...chemicalClass,
      seeds: chemicalClass.seeds.map((item, position) => (position === index ? seed : item))
    });
  }

  const usesTemplate = Boolean(chemicalClass.templateId);
  const seedSourcesEnabled = !usesTemplate || chemicalClass.substituentSources.some((source) => source !== "curated");

  return (
    <Tabs
      className="design-category-tabs"
      tabPosition="left"
      items={[
        {
          key: "template",
          label: t("design.template"),
          forceRender: true,
          children: (
            <div className="design-request-category design-category-template">
              <Typography.Text type="secondary">{t(usesTemplate ? "design.dimensionChemicalClassHelp" : "design.noTemplateHelp")}</Typography.Text>
              {catalogueError ? (
                <Alert
                  type="error"
                  showIcon
                  message={t("design.templatesUnavailable")}
                  description={
                    <Space direction="vertical" size={2}>
                      <span>{catalogueError.summary}</span>
                      <span translate="no">{catalogueError.detail}</span>
                    </Space>
                  }
                />
              ) : null}
              <Select
                style={{ width: "100%" }}
                allowClear
                value={chemicalClass.templateId}
                placeholder={t("design.noTemplate")}
                aria-label={t("design.template")}
                loading={!catalogue && !catalogueError}
                onChange={(value) => onChemicalClass({ ...chemicalClass, templateId: value ?? "" })}
                options={[{ value: "", label: t("design.noTemplate") }, ...(catalogue?.templates ?? []).map((item) => ({
                  value: item.id,
                  label: (
                    <span>
                      {templateLabelKeys[item.id] ? t(templateLabelKeys[item.id]) : item.label}{" "}
                      <span translate="no">({item.formulaSketch})</span>
                    </span>
                  )
                }))]}
              />
              {template ? (
                <Typography.Text type="secondary">
                  {t("design.templateDegree")}: {template.degree} — {t("design.templateClasses")}:{" "}
                  {template.chemicalClasses.map((label) => (
                    <Tag key={label} translate="no">
                      {label}
                    </Tag>
                  ))}
                </Typography.Text>
              ) : null}
            </div>
          )
        },
        {
          key: "rules",
          label: t(usesTemplate ? "design.substituentRules" : "design.candidateConstraints"),
          forceRender: true,
          children: (
            <div className="design-request-category design-category-rules">
              {!usesTemplate ? (
                <CandidateConstraintsForm value={chemicalClass.candidateConstraints} onChange={(candidateConstraints) => onChemicalClass({ ...chemicalClass, candidateConstraints })} />
              ) : template ? (
                <>
                  <Space size={8} wrap>
                    <span>{t("design.permittedElements")}</span>
                    <Select
                      mode="multiple"
                      maxTagCount="responsive"
                      style={{ width: 220, maxWidth: "100%" }}
                      value={chemicalClass.constraints.permittedElements}
                      aria-label={t("design.permittedElements")}
                      onChange={(value) => setConstraint("permittedElements", value)}
                      options={SELECTABLE_ELEMENTS.map((element) => ({ value: element, label: element }))}
                    />
                  </Space>
                  <Space size={8} wrap>
                    <span>{t("design.allowedTypes")}</span>
                    <Select
                      mode="multiple"
                      maxTagCount="responsive"
                      style={{ width: 320, maxWidth: "100%" }}
                      value={chemicalClass.constraints.allowedTypes}
                      aria-label={t("design.allowedTypes")}
                      onChange={(value) => setConstraint("allowedTypes", value)}
                      options={SUBSTITUENT_TYPES.map((type) => ({
                        value: type,
                        label: t(substituentTypeLabelKeys[type])
                      }))}
                    />
                  </Space>
                  <Space size={8} wrap>
                    <span>{t("design.heavyAtomsRange")}</span>
                    <InputNumber
                      min={1}
                      max={60}
                      value={chemicalClass.constraints.minHeavyAtoms}
                      aria-label={t("design.minHeavyAtoms")}
                      onChange={(value) => setConstraint("minHeavyAtoms", value ?? 1)}
                    />
                    <span>–</span>
                    <InputNumber
                      min={1}
                      max={60}
                      value={chemicalClass.constraints.maxHeavyAtoms}
                      aria-label={t("design.maxHeavyAtoms")}
                      onChange={(value) => setConstraint("maxHeavyAtoms", value ?? 1)}
                    />
                    <span>{t("design.maxBranchPoints")}</span>
                    <InputNumber
                      min={0}
                      max={20}
                      value={chemicalClass.constraints.maxBranchPoints}
                      aria-label={t("design.maxBranchPoints")}
                      onChange={(value) => setConstraint("maxBranchPoints", value ?? 0)}
                    />
                  </Space>
                </>
              ) : (
                <Alert type="info" showIcon message={t("design.chooseTemplate")} />
              )}
            </div>
          )
        },
        {
          key: "sources",
          label: t("design.substituentSources"),
          forceRender: true,
          children: (
            <div className="design-request-category design-category-sources">
              {template ? (
                <>
                  <Checkbox.Group
                    value={chemicalClass.substituentSources}
                    onChange={(value) => onChemicalClass({ ...chemicalClass, substituentSources: value as string[] })}
                    options={SUBSTITUENT_SOURCES.map((source) => ({
                      value: source,
                      label: t(substituentSourceLabelKeys[source])
                    }))}
                  />
                  <Typography.Text type="secondary">{t("design.bricsHelp")}</Typography.Text>
                  {chemicalClass.substituentSources.includes("curated") && catalogue ? (
                    <Select
                      mode="multiple"
                      maxTagCount="responsive"
                      allowClear
                      style={{ width: "100%" }}
                      value={chemicalClass.curatedSubstituentIds}
                      placeholder={t("design.allCuratedSubstituents")}
                      aria-label={t("design.curatedSubstituents")}
                      onChange={(value) =>
                        onChemicalClass({ ...chemicalClass, curatedSubstituentIds: value.length ? value : undefined })
                      }
                      options={catalogue.curatedSubstituents.map((item) => ({
                        value: item.id,
                        label: <span translate="no">{item.name}</span>
                      }))}
                    />
                  ) : null}
                </>
              ) : (
                <Alert type="info" showIcon message={t(usesTemplate ? "design.chooseTemplate" : "design.noTemplateHelp")} />
              )}
            </div>
          )
        },
        {
          key: "seeds",
          label: t("design.seeds"),
          forceRender: true,
          disabled: !seedSourcesEnabled,
          children: (
            <div className="design-request-category design-category-seeds">
              {template || !usesTemplate ? (
                <>
                  {seedSourcesEnabled ? (
                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                      <Typography.Text strong>{t("design.seeds")}</Typography.Text>
                      <Typography.Text type="secondary">{t("design.seedsHelp")}</Typography.Text>
                      {chemicalClass.seeds.length > 0 ? (
                        <Select
                          aria-label={t("design.seeds")}
                          value={activeSeed}
                          onChange={setSelectedSeed}
                          options={chemicalClass.seeds.map((seed, index) => ({
                            value: index,
                            label: seed.label || seed.moleculeId || seed.smiles || String(index + 1)
                          }))}
                        />
                      ) : null}
                      {chemicalClass.seeds.map((seed, index) =>
                        index === activeSeed ? (
                          <Space key={index} size={8} wrap>
                            <Select
                              style={{ width: 150 }}
                              value={seed.source}
                              aria-label={t("design.seedSource")}
                              onChange={(value) =>
                                setSeed(index, { source: value, moleculeId: "", smiles: "", label: "" })
                              }
                              options={[
                                { value: "library", label: t("design.seedFromLibrary") },
                                { value: "user", label: t("design.seedFromInput") }
                              ]}
                            />
                            {seed.source === "library" ? (
                              <div style={{ width: 280, maxWidth: "100%" }}>
                                <MoleculePicker
                                  value={seed.moleculeId || undefined}
                                  placeholder={t("design.seedPickMolecule")}
                                  onChange={(value) => setSeed(index, { ...seed, moleculeId: value })}
                                />
                              </div>
                            ) : (
                              <Input
                                style={{ width: 320 }}
                                value={seed.smiles}
                                placeholder={t("design.seedSmiles")}
                                aria-label={t("design.seedSmiles")}
                                onChange={(event) => setSeed(index, { ...seed, smiles: event.target.value })}
                              />
                            )}
                            <Button
                              onClick={() =>
                                onChemicalClass({
                                  ...chemicalClass,
                                  seeds: chemicalClass.seeds.filter((_, position) => position !== index)
                                })
                              }
                            >
                              {t("model.candidateRemove")}
                            </Button>
                          </Space>
                        ) : null
                      )}
                      <Button
                        disabled={chemicalClass.seeds.length >= maxSeeds}
                        onClick={() => {
                          setSelectedSeed(chemicalClass.seeds.length);
                          onChemicalClass({
                            ...chemicalClass,
                            seeds: [
                              ...chemicalClass.seeds,
                              { source: "library", moleculeId: "", smiles: "", label: "" }
                            ]
                          });
                        }}
                      >
                        {t("design.addSeed")}
                      </Button>
                    </Space>
                  ) : null}
                </>
              ) : (
                <Alert type="info" showIcon message={t("design.chooseTemplate")} />
              )}
            </div>
          )
        },
        {
          key: "generation",
          label: t("design.generationSettings"),
          forceRender: true,
          children: (
            <div className="design-request-category design-category-generation">
              {template || !usesTemplate ? (
                <>
                  <Space size={12} wrap>
                    {template && template.degree > 1 ? (
                      <Checkbox
                        checked={chemicalClass.identicalSubstituents}
                        onChange={(event) =>
                          onChemicalClass({ ...chemicalClass, identicalSubstituents: event.target.checked })
                        }
                      >
                        {t("design.identicalSubstituents")}
                      </Checkbox>
                    ) : null}
                    <span>{t("design.maxCandidates")}</span>
                    <InputNumber
                      min={1}
                      max={maxCandidates}
                      value={chemicalClass.maxCandidates}
                      aria-label={t("design.maxCandidates")}
                      onChange={(value) => onChemicalClass({ ...chemicalClass, maxCandidates: value ?? 1 })}
                    />
                    <span>{t("design.randomSeed")}</span>
                    <InputNumber
                      value={chemicalClass.randomSeed}
                      aria-label={t("design.randomSeed")}
                      onChange={(value) => onChemicalClass({ ...chemicalClass, randomSeed: value })}
                    />
                  </Space>
                  <Typography.Text type="secondary">{t("design.randomSeedHelp")}</Typography.Text>
                </>
              ) : (
                <Alert type="info" showIcon message={t("design.chooseTemplate")} />
              )}
            </div>
          )
        },
        {
          key: "target",
          label: t("design.dimensionTarget"),
          forceRender: true,
          children: (
            <div className="design-request-category design-category-target">
              <Typography.Text type="secondary">{t("design.dimensionTargetHelp")}</Typography.Text>
              <Select
                style={{ width: "100%" }}
                allowClear
                value={target.targetFunction || undefined}
                placeholder={t("design.targetFunction")}
                aria-label={t("design.targetFunction")}
                onChange={(value) => onTarget({ ...target, targetFunction: value ?? "" })}
                options={additiveFunctionTags.map((tag) => ({ value: tag, label: t(additiveFunctionLabelKeys[tag]) }))}
              />
              <Select
                style={{ width: "100%" }}
                allowClear
                value={target.targetMetric || undefined}
                placeholder={t("design.targetMetric")}
                aria-label={t("design.targetMetric")}
                onChange={(value) => onTarget({ ...target, targetMetric: value ?? "" })}
                options={metrics.map((metric) => ({ value: metric.column, label: metric.label }))}
              />
              <Alert
                type="info"
                showIcon
                message={t("design.intentNotPropertyTitle")}
                description={t("design.intentNotPropertyBody")}
              />
            </div>
          )
        },
        {
          key: "context",
          label: t("design.dimensionContext"),
          forceRender: true,
          children: (
            <div className="design-request-category design-category-context">
              <Typography.Text type="secondary">{t("design.dimensionContextHelp")}</Typography.Text>
              <Select
                style={{ width: "100%" }}
                allowClear
                showSearch
                optionFilterProp="label"
                value={context.baseOilId || undefined}
                placeholder={t("formulation.baseOil")}
                aria-label={t("formulation.baseOil")}
                onChange={(value) => {
                  const oil = baseOils.find((item) => item.id === value);
                  onContext({ ...context, baseOilId: value ?? "", baseOilName: oil?.name ?? "" });
                }}
                options={baseOils.map((oil) => ({ value: oil.id, label: oil.name }))}
              />
              <Space size={8} wrap>
                <span>{t("model.concentration")}</span>
                <InputNumber
                  min={0}
                  step={0.1}
                  value={context.concentration ?? null}
                  aria-label={t("model.concentration")}
                  onChange={(value) => onContext({ ...context, concentration: value ?? undefined })}
                />
                <Select
                  style={{ width: 150 }}
                  value={context.concentrationUnit}
                  aria-label={t("model.concentrationUnit")}
                  onChange={(value) => onContext({ ...context, concentrationUnit: value })}
                  options={CONCENTRATION_UNITS.map((unit) => ({ value: unit, label: unit }))}
                />
              </Space>
              <Input
                value={context.otherComponents}
                placeholder={t("design.otherComponents")}
                aria-label={t("design.otherComponents")}
                onChange={(event) => onContext({ ...context, otherComponents: event.target.value })}
              />
              <Select
                style={{ width: "100%" }}
                allowClear
                showSearch
                value={context.testType || undefined}
                placeholder={t("design.testType")}
                aria-label={t("design.testType")}
                onChange={(value) => onContext({ ...context, testType: value ?? "" })}
                options={testTypes.map((type) => ({ value: type, label: <span translate="no">{type}</span> }))}
              />
              <Space size={8} wrap>
                <span>{t("design.conditionTemperature")}</span>
                <InputNumber
                  value={context.temperatureValue ?? null}
                  aria-label={t("design.conditionTemperature")}
                  onChange={(value) => onContext({ ...context, temperatureValue: value ?? undefined })}
                />
                <Select
                  style={{ width: 90 }}
                  value={context.temperatureUnit}
                  aria-label={t("design.temperatureUnit")}
                  onChange={(value) => onContext({ ...context, temperatureUnit: value })}
                  options={TEMPERATURE_UNITS.map((unit) => ({ value: unit, label: unit }))}
                />
                <span>{t("design.conditionLoad")}</span>
                <InputNumber
                  min={0}
                  value={context.loadValue ?? null}
                  aria-label={t("design.conditionLoad")}
                  onChange={(value) => onContext({ ...context, loadValue: value ?? undefined })}
                />
                <Select
                  style={{ width: 90 }}
                  value={context.loadUnit}
                  aria-label={t("design.loadUnit")}
                  onChange={(value) => onContext({ ...context, loadUnit: value })}
                  options={LOAD_UNITS.map((unit) => ({ value: unit, label: unit }))}
                />
              </Space>
              <Typography.Text type="secondary">{t("design.contextHandlingHelp")}</Typography.Text>
            </div>
          )
        }
      ]}
    />
  );
}
