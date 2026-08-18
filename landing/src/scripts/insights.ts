import * as Plot from "@observablehq/plot";

type PackedOverview = [
  region: number,
  sector: number,
  accreditationType: number,
  expiryMonth: number,
  expiryBucket: number,
  count: number,
];

type PackedSubsector = [
  region: number,
  sector: number,
  subsector: number,
  accreditationType: number,
  count: number,
];

interface InsightsData {
  meta: {
    snapshotDate: string;
    source: string;
    totalRecords: number;
    validNzbn: number;
    canonicalRegionCount: number;
    unknownRegionRecords: number;
  };
  regions: string[];
  sectors: string[];
  subsectorNames: string[];
  accreditationTypes: string[];
  expiryMonths: string[];
  expiryBuckets: string[];
  overview: PackedOverview[];
  subsectors: PackedSubsector[];
}

interface FilterState {
  region: number | null;
  sector: number | null;
  accreditationType: number | null;
}

interface IgnoredFilters {
  region?: boolean;
  sector?: boolean;
}

const colours = {
  harbour: "#052d35",
  pounamu: "#087a5c",
  pounamuDark: "#075c48",
  pounamuMid: "#62a994",
  pounamuSoft: "#dff2eb",
  kowhai: "#e5b647",
  kowhaiSoft: "#fbf3dc",
  slate: "#526b67",
  line: "#cbded9",
  lineLight: "#e2ece9",
  mist: "#edf5f3",
};

const number = new Intl.NumberFormat("en-NZ");
const percent = new Intl.NumberFormat("en-NZ", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const monthLabel = new Intl.DateTimeFormat("en-NZ", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing insights element: ${id}`);
  }
  return element as T;
}

function selectValue(select: HTMLSelectElement): number | null {
  return select.value === "all" ? null : Number(select.value);
}

function appendPlot(host: HTMLElement, plot: Element, label: string): void {
  plot.setAttribute("role", "img");
  plot.setAttribute("aria-label", label);
  host.replaceChildren(plot);
  host.setAttribute("aria-busy", "false");
}

function aggregate<T>(
  rows: T[],
  key: (row: T) => string,
  value: (row: T) => number,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const group = key(row);
    totals.set(group, (totals.get(group) ?? 0) + value(row));
  }
  return totals;
}

function topWithOther(
  totals: Map<string, number>,
  limit: number,
  otherLabel: string,
  selectedLabel?: string,
): Array<{ label: string; count: number; isOther: boolean; isSelected: boolean }> {
  const ranked = [...totals]
    .map(([label, count]) => ({
      label,
      count,
      isOther: false,
      isSelected: label === selectedLabel,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (ranked.length <= limit) return ranked;

  const selected = selectedLabel
    ? ranked.find((item) => item.label === selectedLabel)
    : undefined;
  const visible = ranked.slice(0, limit);
  if (selected && !visible.includes(selected)) {
    visible[visible.length - 1] = selected;
    visible.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }
  const visibleLabels = new Set(visible.map((item) => item.label));
  visible.push({
    label: otherLabel,
    count: ranked
      .filter((item) => !visibleLabels.has(item.label))
      .reduce((sum, item) => sum + item.count, 0),
    isOther: true,
    isSelected: false,
  });
  return visible;
}

function shortSector(value: string): string {
  const labels: Record<string, string> = {
    "Agriculture, Forestry and Fishing": "Agriculture & fishing",
    "Professional, Scientific and Technical Services": "Professional & technical",
    "Health Care and Social Assistance": "Health care & social assistance",
    "Transport, Postal and Warehousing": "Transport & warehousing",
    "Administrative and Support Services": "Administrative & support",
    "Rental, Hiring and Real Estate Services": "Rental & real estate",
    "Information Media and Telecommunications": "Information & telecoms",
    "Financial and Insurance Services": "Financial & insurance",
    "Arts and Recreation Services": "Arts & recreation",
    "Public Administration and Safety": "Public administration",
    "Electricity, Gas, Water and Waste Services": "Utilities & waste",
  };
  return labels[value] ?? value;
}

function compactSector(value: string): string {
  return value === "Accommodation and Food Services"
    ? "Accommodation & food"
    : shortSector(value);
}

function decodeMonth(value: string): Date {
  return new Date(`${value}-01T00:00:00Z`);
}

function ordinal(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

function parseHex(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`Expected a six-digit hex colour, received ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16)) as [number, number, number];
}

function matrixColour(value: number, max: number): string {
  const position = Math.sqrt(value / Math.max(1, max));
  const palette = [
    colours.mist,
    "#b8d8cf",
    "#75b9a7",
    colours.pounamu,
    colours.pounamuDark,
    colours.harbour,
  ];
  return palette[Math.min(palette.length - 1, Math.floor(position * palette.length))];
}

function relativeLuminance(value: string): number {
  const channels = parseHex(value).map((channel) => {
    const normalised = channel / 255;
    return normalised <= 0.04045
      ? normalised / 12.92
      : ((normalised + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function matrixTextColour(background: string): string {
  return contrastRatio(background, "#ffffff") > contrastRatio(background, colours.harbour)
    ? "#ffffff"
    : colours.harbour;
}

export function initInsights(): void {
  const dataElement = requiredElement<HTMLScriptElement>("insights-data");
  const data = JSON.parse(dataElement.textContent ?? "") as InsightsData;
  const regionSelect = requiredElement<HTMLSelectElement>("insights-region");
  const sectorSelect = requiredElement<HTMLSelectElement>("insights-sector");
  const typeSelect = requiredElement<HTMLSelectElement>("insights-type");
  const resetButton = requiredElement<HTMLButtonElement>("insights-reset");
  const chartRegion = requiredElement("chart-region");
  const chartSector = requiredElement("chart-sector");
  const chartMatrix = requiredElement("chart-matrix");
  const chartExpiry = requiredElement("chart-expiry");
  const section = requiredElement("insights-dashboard");

  let frame = 0;

  const state = (): FilterState => ({
    region: selectValue(regionSelect),
    sector: selectValue(sectorSelect),
    accreditationType: selectValue(typeSelect),
  });

  const overviewRows = (
    filters: FilterState,
    ignored: IgnoredFilters = {},
  ): PackedOverview[] =>
    data.overview.filter(
      ([region, sector, accreditationType]) =>
        (ignored.region || filters.region === null || filters.region === region) &&
        (ignored.sector || filters.sector === null || filters.sector === sector) &&
        (filters.accreditationType === null ||
          filters.accreditationType === accreditationType),
    );

  const updateKpis = (
    rows: PackedOverview[],
    regionContextRows: PackedOverview[],
    sectorContextRows: PackedOverview[],
    filters: FilterState,
  ): void => {
    const total = rows.reduce((sum, row) => sum + row[5], 0);
    const regionCount = new Set(
      rows
        .map((row) => row[0])
        .filter((index) => data.regions[index] !== "Unknown / other"),
    ).size;
    const sectorTotals = aggregate(
      rows,
      (row) => String(row[1]),
      (row) => row[5],
    );
    const largestSector = [...sectorTotals].sort((a, b) => b[1] - a[1])[0];
    const expiringSoon = rows.reduce(
      (sum, row) => sum + ([1, 2].includes(row[4]) ? row[5] : 0),
      0,
    );

    requiredElement("kpi-records").textContent = number.format(total);
    const regionContextTotal = regionContextRows.reduce((sum, row) => sum + row[5], 0);
    requiredElement("kpi-regions").textContent = filters.region === null
      ? number.format(regionCount)
      : regionContextTotal
        ? percent.format(total / regionContextTotal)
        : "—";
    requiredElement("kpi-region-label").textContent = filters.region === null
      ? "NZ regions represented"
      : `${data.regions[filters.region]} share across NZ`;
    const sectorContextTotal = sectorContextRows.reduce((sum, row) => sum + row[5], 0);
    requiredElement("kpi-sector-share").textContent = filters.sector === null
      ? total && largestSector
        ? percent.format(largestSector[1] / total)
        : "—"
      : sectorContextTotal
        ? percent.format(total / sectorContextTotal)
        : "—";
    requiredElement("kpi-expiry").textContent = number.format(expiringSoon);
    requiredElement("expiry-note-count").textContent = number.format(expiringSoon);
    requiredElement("kpi-sector-label").textContent = filters.sector === null
      ? largestSector
        ? `${data.sectors[Number(largestSector[0])]} share`
        : "Largest sector share"
      : filters.region === null
        ? "Share of NZ records"
        : `Share of ${data.regions[filters.region]} records`;

    const activeFilters = [
      filters.region === null ? null : data.regions[filters.region],
      filters.sector === null ? null : data.sectors[filters.sector],
      filters.accreditationType === null
        ? null
        : data.accreditationTypes[filters.accreditationType],
    ].filter(Boolean);
    requiredElement("insights-filter-status").textContent = activeFilters.length
      ? `Showing ${number.format(total)} records matching ${activeFilters.join(", ")}.`
      : `Showing all ${number.format(total)} records in the official snapshot.`;
  };

  const renderRegion = (rows: PackedOverview[], filters: FilterState): void => {
    const totals = aggregate(
      rows,
      (row) => data.regions[row[0]],
      (row) => row[5],
    );
    const selectedRegion = filters.region === null ? undefined : data.regions[filters.region];
    const chartData = topWithOther(totals, 6, "Other regions", selectedRegion);
    const total = chartData.reduce((sum, item) => sum + item.count, 0);
    const max = Math.max(1, ...chartData.map((item) => item.count));
    const width = Math.max(chartRegion.clientWidth, 320);
    const leadingRegion = chartData[0]?.label;
    const plot = Plot.plot({
      width,
      height: 310,
      marginTop: 8,
      marginRight: width < 520 ? 48 : 72,
      marginBottom: 28,
      marginLeft: width < 520 ? 112 : 146,
      style: { background: "transparent", color: colours.slate, fontFamily: "inherit" },
      x: { axis: null, domain: [0, max * 1.2], label: null },
      y: { domain: chartData.map((item) => item.label), label: null, tickSize: 0 },
      marks: [
        Plot.barX(chartData, {
          x: "count",
          y: "label",
          fill: (item) => {
            if (item.isOther) return colours.pounamuSoft;
            if (selectedRegion) return item.isSelected ? colours.pounamu : colours.pounamuSoft;
            return item.label === leadingRegion ? colours.pounamu : colours.pounamuMid;
          },
          sort: null,
          insetTop: 4,
          insetBottom: 4,
          rx: 2,
          tip: true,
          title: (item) => `${item.label}\n${number.format(item.count)} records`,
        }),
        Plot.text(chartData, {
          x: "count",
          y: "label",
          text: (item) => number.format(item.count),
          dx: 7,
          textAnchor: "start",
          fill: colours.harbour,
          fontWeight: 650,
        }),
        Plot.ruleX([0], { stroke: colours.line }),
      ],
    });
    appendPlot(
      chartRegion,
      plot,
      `Accredited employer records by region. ${chartData
        .map((item) => `${item.label}: ${number.format(item.count)}`)
        .join("; ")}.`,
    );
    const ranked = [...totals]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const first = ranked[0];
    const selected = selectedRegion
      ? ranked.find((item) => item.label === selectedRegion)
      : undefined;
    requiredElement("region-chart-title").textContent = selectedRegion
      ? `How ${selectedRegion} compares`
      : "Where accredited employers are based";
    requiredElement("region-chart-description").textContent = selectedRegion
      ? "Records by region under the current sector and accreditation type filters"
      : "Number of official records by region";
    requiredElement("region-callout").textContent = selected && total
      ? `${selected.label} ranks ${ordinal(ranked.indexOf(selected) + 1)}, with ${number.format(selected.count)} records and ${percent.format(selected.count / total)} of this NZ view.`
      : first && total
        ? `${first.label} accounts for ${percent.format(first.count / total)} of this view.`
        : "No region data matches these filters.";
  };

  const renderSector = (rows: PackedOverview[], filters: FilterState): void => {
    const width = Math.max(chartSector.clientWidth, 320);
    const sectorLabel = width < 420 ? compactSector : shortSector;
    let totals: Map<string, number>;
    let title = "Sector composition";
    let description = "Share of official records";

    if (filters.sector === null) {
      totals = aggregate(
        rows,
        (row) => sectorLabel(data.sectors[row[1]]),
        (row) => row[5],
      );
    } else {
      const matching = data.subsectors.filter(
        ([region, sector, , accreditationType]) =>
          sector === filters.sector &&
          (filters.region === null || region === filters.region) &&
          (filters.accreditationType === null ||
            accreditationType === filters.accreditationType),
      );
      totals = aggregate(
        matching,
        (row) => data.subsectorNames[row[2]],
        (row) => row[4],
      );
      title = "Subsector composition";
      description = `Within ${shortSector(data.sectors[filters.sector])}`;
    }

    requiredElement("sector-chart-title").textContent = title;
    requiredElement("sector-chart-description").textContent = description;
    requiredElement("sector-panel-hint").textContent = filters.sector === null
      ? "Choose a sector to see subsectors"
      : "Top subsectors by share";
    const total = [...totals.values()].reduce((sum, count) => sum + count, 0);
    const chartData = [...totals]
      .map(([label, count]) => ({ label, count, isOther: false }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 6);
    const points = chartData.map((item) => ({
      ...item,
      share: total ? item.count / total : 0,
    }));
    const plot = Plot.plot({
      width,
      height: 310,
      marginTop: 8,
      marginRight: 58,
      marginBottom: 28,
      marginLeft: width < 420 ? 132 : 216,
      style: { background: "transparent", color: colours.slate, fontFamily: "inherit" },
      x: {
        axis: "bottom",
        domain: [0, Math.max(0.01, ...points.map((item) => item.share)) * 1.12],
        tickFormat: (value) => percent.format(value),
        ticks: 4,
        label: null,
        grid: true,
      },
      y: { axis: null, domain: points.map((item) => item.label), label: null },
      marks: [
        Plot.axisY({
          tickSize: 0,
          label: null,
          lineWidth: filters.sector === null ? (width < 420 ? 11 : 20) : (width < 420 ? 10 : 18),
        }),
        Plot.barX(points, {
          x: "share",
          y: "label",
          fill: colours.pounamu,
          insetTop: 5,
          insetBottom: 5,
          rx: 2,
          tip: true,
          title: (item) => `${item.label}\n${number.format(item.count)} records · ${percent.format(item.share)}`,
        }),
        Plot.text(points, {
          x: "share",
          y: "label",
          text: (item) => percent.format(item.share),
          dx: 9,
          textAnchor: "start",
          fill: colours.harbour,
          fontWeight: 650,
        }),
      ],
    });
    appendPlot(
      chartSector,
      plot,
      `${title}. ${points
        .map((item) => `${item.label}: ${percent.format(item.share)}`)
        .join("; ")}.`,
    );
  };

  const renderMatrix = (rows: PackedOverview[], filters: FilterState): void => {
    const regionTotals = aggregate(
      rows,
      (row) => String(row[0]),
      (row) => row[5],
    );
    const sectorTotals = aggregate(
      rows,
      (row) => String(row[1]),
      (row) => row[5],
    );
    const regionIndexes = [...regionTotals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([key]) => Number(key));
    if (filters.region !== null && !regionIndexes.includes(filters.region)) {
      regionIndexes[regionIndexes.length - 1] = filters.region;
    }
    const sectorIndexes = [...sectorTotals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key]) => Number(key));
    if (filters.sector !== null && !sectorIndexes.includes(filters.sector)) {
      sectorIndexes[sectorIndexes.length - 1] = filters.sector;
    }
    const width = Math.max(chartMatrix.clientWidth, 320);
    const compact = width < 680;
    const sectorLabel = compact ? compactSector : shortSector;
    const selected = new Map<string, number>();
    for (const row of rows) {
      if (!regionIndexes.includes(row[0]) || !sectorIndexes.includes(row[1])) continue;
      const key = `${row[0]}:${row[1]}`;
      selected.set(key, (selected.get(key) ?? 0) + row[5]);
    }
    const matrix = regionIndexes.flatMap((region) =>
      sectorIndexes.map((sector) => ({
        region: data.regions[region],
        sector: sectorLabel(data.sectors[sector]),
        count: selected.get(`${region}:${sector}`) ?? 0,
        selectedRegion: filters.region === region,
        selectedSector: filters.sector === sector,
        officialSector: data.sectors[sector],
      })),
    );
    const max = Math.max(1, ...matrix.map((item) => item.count));
    const plot = Plot.plot({
      width,
      height: compact ? 390 : 360,
      marginTop: compact ? 112 : 104,
      marginRight: 16,
      marginBottom: 18,
      marginLeft: compact ? 104 : 142,
      style: { background: "transparent", color: "rgba(255,255,255,0.7)", fontFamily: "inherit" },
      x: { axis: "top", domain: sectorIndexes.map((index) => sectorLabel(data.sectors[index])), label: null, tickRotate: compact ? -38 : -24, tickSize: 0 },
      y: { domain: regionIndexes.map((index) => data.regions[index]), label: null, tickSize: 0 },
      marks: [
        Plot.cell(matrix, {
          x: "sector",
          y: "region",
          fill: (item) => matrixColour(item.count, max),
          stroke: (item) => item.selectedRegion && item.selectedSector
            ? colours.kowhai
            : item.selectedRegion || item.selectedSector
              ? "rgba(229,182,71,0.72)"
              : "none",
          strokeWidth: 2,
          inset: 1,
          rx: 3,
          ariaLabel: (item) => `${item.region}, ${item.officialSector}: ${number.format(item.count)} records`,
        }),
        ...(compact ? [] : [
          Plot.text(matrix, {
            x: "sector",
            y: "region",
            text: (item) => number.format(item.count),
            fill: (item) => matrixTextColour(matrixColour(item.count, max)),
            fontWeight: 650,
            ariaHidden: "true",
          }),
        ]),
      ],
    });
    appendPlot(
      chartMatrix,
      plot,
      `Region and sector overlap for ${number.format(
        rows.reduce((sum, row) => sum + row[5], 0),
      )} records. Darker cells contain more records.`,
    );
  };

  const renderExpiry = (rows: PackedOverview[]): void => {
    const snapshot = decodeMonth(data.meta.snapshotDate.slice(0, 7));
    const horizon = Array.from({ length: 12 }, (_, index) => {
      const month = new Date(Date.UTC(snapshot.getUTCFullYear(), snapshot.getUTCMonth() + index + 1, 1));
      return month.toISOString().slice(0, 7);
    });
    const totals = aggregate(
      rows.filter((row) => horizon.includes(data.expiryMonths[row[3]])),
      (row) => data.expiryMonths[row[3]],
      (row) => row[5],
    );
    const chartData = horizon.map((month, index) => ({
      month,
      label: monthLabel.format(decodeMonth(month)),
      count: totals.get(month) ?? 0,
      nearTerm: index < 3,
    }));
    const width = Math.max(chartExpiry.clientWidth, 320);
    const compact = width < 660;
    const max = Math.max(1, ...chartData.map((item) => item.count));
    const plot = Plot.plot({
      width,
      height: compact ? 340 : 330,
      marginTop: 28,
      marginRight: 18,
      marginBottom: compact ? 62 : 42,
      marginLeft: 54,
      style: { background: "transparent", color: colours.slate, fontFamily: "inherit" },
      x: { domain: horizon, tickFormat: (month) => monthLabel.format(decodeMonth(month)), tickRotate: compact ? -45 : 0, label: null, tickSize: 0 },
      y: { domain: [0, max * 1.16], ticks: 5, grid: true, label: null, tickFormat: (value) => number.format(value) },
      marks: [
        Plot.barY(chartData, {
          x: "month",
          y: "count",
          fill: (item) => item.nearTerm ? colours.kowhai : colours.pounamu,
          insetLeft: compact ? 2 : 6,
          insetRight: compact ? 2 : 6,
          rx: 2,
          tip: true,
          title: (item) => `${item.label}\n${number.format(item.count)} scheduled expiries`,
        }),
        ...(compact ? [] : [
          Plot.text(chartData, {
            x: "month",
            y: "count",
            text: (item) => number.format(item.count),
            dy: -8,
            fill: colours.harbour,
            fontWeight: 650,
          }),
        ]),
        Plot.ruleY([0], { stroke: colours.line }),
      ],
    });
    appendPlot(
      chartExpiry,
      plot,
      `Scheduled accreditation expiries by calendar month from ${chartData[0].label} to ${chartData.at(-1)?.label}. ${chartData
        .map((item) => `${item.label}: ${number.format(item.count)}`)
        .join("; ")}.`,
    );
  };

  const render = (): void => {
    const filters = state();
    const rows = overviewRows(filters);
    const regionContextRows = overviewRows(filters, { region: true });
    const sectorContextRows = overviewRows(filters, { sector: true });
    const matrixContextRows = overviewRows(filters, { region: true, sector: true });
    updateKpis(rows, regionContextRows, sectorContextRows, filters);
    renderRegion(regionContextRows, filters);
    renderSector(rows, filters);
    renderMatrix(matrixContextRows, filters);
    renderExpiry(rows);
  };

  const scheduleRender = (): void => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(render);
  };

  for (const control of [regionSelect, sectorSelect, typeSelect]) {
    control.addEventListener("change", scheduleRender);
  }
  resetButton.addEventListener("click", () => {
    regionSelect.value = "all";
    sectorSelect.value = "all";
    typeSelect.value = "all";
    scheduleRender();
    regionSelect.focus();
  });

  let observedWidth = Math.round(section.clientWidth);
  const observer = new ResizeObserver(([entry]) => {
    const nextWidth = Math.round(entry.contentRect.width);
    if (nextWidth === observedWidth) return;
    observedWidth = nextWidth;
    scheduleRender();
  });
  observer.observe(section);
  render();
}
