/**
 * In-process Prometheus text exposition. Counters/gauges for chat WS recovery.
 */
type Counter = { help: string; value: number };
type Gauge = { help: string; value: number };

const counters = new Map<string, Counter>();
const gauges = new Map<string, Gauge>();

function counter(name: string, help: string): Counter {
  let row = counters.get(name);
  if (!row) {
    row = { help, value: 0 };
    counters.set(name, row);
  }
  return row;
}

function gauge(name: string, help: string): Gauge {
  let row = gauges.get(name);
  if (!row) {
    row = { help, value: 0 };
    gauges.set(name, row);
  }
  return row;
}

export function incMetric(name: string, help: string, by = 1): void {
  counter(name, help).value += by;
}

export function setGauge(name: string, help: string, value: number): void {
  gauge(name, help).value = value;
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  for (const [name, row] of gauges) {
    lines.push(`# HELP ${name} ${row.help}`, `# TYPE ${name} gauge`, `${name} ${row.value}`);
  }
  for (const [name, row] of counters) {
    lines.push(`# HELP ${name} ${row.help}`, `# TYPE ${name} counter`, `${name} ${row.value}`);
  }
  return `${lines.join("\n")}\n`;
}
