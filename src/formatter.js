/**
 * Terminal Formatting Utilities for Emblem Enhanced TUI
 * Chalk v5 ESM — rich output formatting, tables, progress indicators
 */

import chalk from 'chalk';

// ============================================================================
// Color Scheme
// ============================================================================

const colors = {
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
  dim: chalk.dim,
  highlight: chalk.bold.white,
  brand: chalk.bold.cyan,
  header: chalk.bold.white,
  border: chalk.dim,
  profit: chalk.green,
  loss: chalk.red,
  neutral: chalk.gray,
};

// ============================================================================
// ANSI Helpers
// ============================================================================

function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

function padRight(str, width) {
  const visible = stripAnsi(str).length;
  const pad = Math.max(0, width - visible);
  return str + ' '.repeat(pad);
}

// ============================================================================
// Box and Banner Formatting
// ============================================================================

function box(title, content, width = 60) {
  const lines = String(content).split('\n');
  const inner = width - 2; // inside the left/right borders

  let top;
  if (title) {
    const titleStr = ` ${title} `;
    const remaining = Math.max(0, inner - titleStr.length - 1);
    top = colors.border('┌─') + colors.brand(titleStr) + colors.border('─'.repeat(remaining)) + colors.border('┐');
  } else {
    top = colors.border('┌' + '─'.repeat(inner) + '┐');
  }

  const bottom = colors.border('└' + '─'.repeat(inner) + '┘');

  const body = lines.map(line => {
    const stripped = stripAnsi(line);
    const pad = Math.max(0, inner - 2 - stripped.length);
    return colors.border('│') + ' ' + line + ' '.repeat(pad) + ' ' + colors.border('│');
  });

  return [top, ...body, bottom].join('\n');
}

function sectionHeader(title, width = 50) {
  const remaining = Math.max(0, width - title.length - 5);
  return `\n${colors.brand('━━━')} ${colors.header(title)} ${colors.brand('━'.repeat(remaining))}\n`;
}

function banner(lines) {
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length));
  const inner = maxLen + 4;

  const top = colors.brand('╔' + '═'.repeat(inner) + '╗');
  const bottom = colors.brand('╚' + '═'.repeat(inner) + '╝');

  const body = lines.map(line => {
    const pad = Math.max(0, inner - 2 - stripAnsi(line).length);
    return colors.brand('║') + ' ' + line + ' '.repeat(pad) + ' ' + colors.brand('║');
  });

  return [top, ...body, bottom].join('\n');
}

// ============================================================================
// Table Formatting
// ============================================================================

function formatTable(headers, rows, opts = {}) {
  if (!rows || rows.length === 0) {
    return colors.dim('  No data available');
  }

  const colCount = headers.length;
  const aligns = opts.aligns || headers.map(() => 'left');

  // Calculate column widths (ANSI-aware)
  const widths = headers.map((h, i) => {
    let max = stripAnsi(h).length;
    for (const row of rows) {
      const cell = String(row[i] ?? '');
      max = Math.max(max, stripAnsi(cell).length);
    }
    return max;
  });

  // Apply explicit widths if provided
  if (opts.widths) {
    for (let i = 0; i < colCount; i++) {
      if (opts.widths[i]) widths[i] = Math.max(widths[i], opts.widths[i]);
    }
  }

  function alignCell(str, width, align) {
    const visible = stripAnsi(str).length;
    const pad = Math.max(0, width - visible);
    if (align === 'right') return ' '.repeat(pad) + str;
    if (align === 'center') {
      const left = Math.floor(pad / 2);
      return ' '.repeat(left) + str + ' '.repeat(pad - left);
    }
    return str + ' '.repeat(pad);
  }

  const headerRow = headers
    .map((h, i) => colors.header(alignCell(h, widths[i], aligns[i])))
    .join('  ');

  const separator = widths
    .map(w => colors.border('─'.repeat(w)))
    .join('──');

  const dataRows = rows.map(row =>
    row
      .map((cell, i) => alignCell(String(cell ?? ''), widths[i], aligns[i]))
      .join('  ')
  );

  return ['', `  ${headerRow}`, `  ${separator}`, ...dataRows.map(r => `  ${r}`), ''].join('\n');
}

// ============================================================================
// Tool Call Formatting
// ============================================================================

function formatToolCall(name, args, debug = false) {
  let line = `  ${chalk.yellow('[tool]')} ${chalk.yellow(name)}`;

  if (debug && args && typeof args === 'object') {
    const pairs = [];
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null) continue;
      let display;
      if (typeof v === 'string') {
        display = v.length > 30 ? v.slice(0, 27) + '...' : v;
        display = display.replace(/\n/g, ' ');
      } else if (Array.isArray(v)) {
        display = `[${v.length} items]`;
      } else if (typeof v === 'object') {
        display = '{...}';
      } else {
        display = String(v);
      }
      pairs.push(`${k}=${display}`);
    }
    if (pairs.length) {
      line += ` ${colors.dim('·')} ${chalk.gray(pairs.join(', '))}`;
    }
  }

  return line;
}

// ============================================================================
// Specialized Formatters
// ============================================================================

function formatBalancesTable(balances) {
  if (!balances || balances.length === 0) {
    return colors.dim('  No balances found');
  }

  const headers = ['Chain', 'Token', 'Balance', 'USD Value'];
  const rows = balances.map(b => [
    String(b.chain ?? ''),
    String(b.symbol ?? b.token ?? ''),
    String(b.balance ?? '0'),
    colors.highlight(String(b.usdValue ?? b.usd ?? '$0.00')),
  ]);

  return formatTable(headers, rows, {
    widths: [12, 10, 16, 14],
    aligns: ['left', 'left', 'right', 'right'],
  });
}

// ============================================================================
// Progress Indicators
// ============================================================================

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function getSpinnerFrame(index) {
  const i = (index >>> 0) % spinnerFrames.length;
  return colors.brand(spinnerFrames[i]);
}

function progressBar(percent, width = 30) {
  const clamped = Math.max(0, Math.min(1, percent));
  const filled = Math.round(width * clamped);
  const empty = width - filled;
  const bar = colors.brand('█'.repeat(filled)) + colors.dim('░'.repeat(empty));
  const pct = colors.highlight(`${Math.round(clamped * 100)}%`);
  return `[${bar}] ${pct}`;
}

function thinking() {
  return `\n${colors.dim('─── ◈ Thinking... ───')}\n`;
}

function complete(cost) {
  const costStr = cost !== undefined ? ` $${Number(cost).toFixed(4)} ───` : ' ───';
  return `\n${colors.dim(`─── ◈ Complete ◈ ──${costStr}`)}\n`;
}

// ============================================================================
// Export
// ============================================================================

const fmt = {
  colors,
  stripAnsi,
  padRight,
  box,
  sectionHeader,
  banner,
  formatTable,
  formatToolCall,
  formatBalancesTable,
  getSpinnerFrame,
  progressBar,
  thinking,
  complete,
};

export default fmt;
