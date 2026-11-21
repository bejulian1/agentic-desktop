import { t } from "../../lib/i18n";
import type { DiffColorScheme, DiffFileState, DiffLayout } from "../../../../shared/protocol";
import { app } from "../../state/app";
import { Choice, Group, Page, Row, save, Toggle } from "./parts";

const LAYOUTS = (): Array<{ value: DiffLayout; label: string }> => [
  { value: "stacked", label: t("Stablet") },
  { value: "split", label: t("Side ved side") },
];

const FILE_STATES = (): Array<{ value: DiffFileState; label: string }> => [
  { value: "expanded", label: t("Utvidet") },
  { value: "collapsed", label: t("Sammenslått") },
];

const COLORS = (): Array<{ value: DiffColorScheme; label: string; swatch: readonly [string, string] }> => [
  { value: "red-green", label: t("Rød og grønn"), swatch: ["#d94a3d", "#2ca35a"] },
  { value: "blue-orange", label: t("Blå og oransje (fargeblindvennlig)"), swatch: ["#d97a26", "#2f78d8"] },
];

export function DiffsPage() {
  return (
    <Page title={t("Differ")}>
      <Group title={t("Differ")}>
        <Row
          label={t("Diff-oppsett")}
          text={t("Vis differ stablet eller side ved side. Bryteren i verktøylinjen for Endringer endrer det samme. Smale paneler bytter automatisk til stablet.")}
        >
          <Choice<DiffLayout>
            label={t("Diff-oppsett")}
            value={app.settings.diffLayout ?? "stacked"}
            options={LAYOUTS()}
            onChange={(diffLayout) => save({ diffLayout })}
          />
        </Row>
        <Toggle
          label={t("Skjul mellomromsendringer")}
          text={t("Velg om diff-visningen skal se bort fra endringer som bare gjelder mellomrom og innrykk.")}
          checked={app.settings.diffIgnoreWhitespace === true}
          onChange={(diffIgnoreWhitespace) => save({ diffIgnoreWhitespace })}
        />
        <Row
          label={t("Standard filvisning")}
          text={t("Start med filer utvidet eller sammenslått når en diff åpnes.")}
        >
          <Choice<DiffFileState>
            label={t("Standard filvisning")}
            value={app.settings.diffFileState ?? "expanded"}
            options={FILE_STATES()}
            onChange={(diffFileState) => save({ diffFileState })}
          />
        </Row>
        <Row
          label={t("Diff-farger")}
          text={t("Velg farger for tillegg og slettinger, inkludert endringstall og ordmarkeringer.")}
        >
          <Choice<DiffColorScheme>
            label={t("Diff-farger")}
            value={app.settings.diffColors ?? "red-green"}
            options={COLORS()}
            onChange={(diffColors) => save({ diffColors })}
          />
        </Row>
      </Group>
    </Page>
  );
}
