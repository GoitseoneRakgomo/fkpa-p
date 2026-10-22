(() => {
  const section = document.querySelector('.metals-performance-section');
  const chart = document.getElementById('performance-chart');
  const grid = document.getElementById('performance-grid');
  const lines = document.getElementById('performance-lines');
  const status = document.getElementById('performance-status');
  const tooltip = document.getElementById('performance-tooltip');
  const retryButton = document.getElementById('performance-retry');
  const goldSummary = document.getElementById('gold-performance');
  const silverSummary = document.getElementById('silver-performance');

  if (!section || !chart || !grid || !lines || !status || !tooltip || !retryButton || !goldSummary || !silverSummary) {
    return;
  }

  const rangeLabels = { '1m': '1 month', '6m': '6 months', '1y': '1 year', '5y': '5 years' };
  const plot = { left: 76, right: 28, top: 24, bottom: 48, width: 960, height: 360 };
  let activeRequest;
  let series;

  function svgElement(tag, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
    return element;
  }

  function indexedPoints(points) {
    const firstPrice = points[0].price;
    return points.map((point) => ({
      ...point,
      change: ((point.price / firstPrice) - 1) * 100,
    }));
  }

  function formatDate(timestamp, includeYear = false) {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(includeYear ? { year: 'numeric' } : {}),
    });
  }

  function formatChange(value) {
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  }

  function drawChart(goldPoints, silverPoints) {
    grid.replaceChildren();
    lines.replaceChildren();

    const allChanges = [...goldPoints, ...silverPoints].map((point) => point.change);
    let minimum = Math.min(0, ...allChanges);
    let maximum = Math.max(0, ...allChanges);
    const spread = maximum - minimum || 1;
    minimum -= spread * 0.12;
    maximum += spread * 0.12;

    const chartWidth = plot.width - plot.left - plot.right;
    const chartHeight = plot.height - plot.top - plot.bottom;
    const xForIndex = (index, length) => plot.left + (index / (length - 1)) * chartWidth;
    const yForChange = (value) => plot.top + ((maximum - value) / (maximum - minimum)) * chartHeight;

    for (let index = 0; index <= 4; index += 1) {
      const value = maximum - ((maximum - minimum) * index / 4);
      const y = yForChange(value);
      grid.append(
        svgElement('line', { x1: plot.left, x2: plot.width - plot.right, y1: y, y2: y, class: 'chart-grid-line' }),
      );
      const label = svgElement('text', { x: plot.left - 12, y: y + 4, 'text-anchor': 'end', class: 'chart-axis-label' });
      label.textContent = formatChange(value);
      grid.append(label);
    }

    [goldPoints[0], goldPoints[goldPoints.length - 1]].forEach((point, index) => {
      const x = index === 0 ? plot.left : plot.width - plot.right;
      const label = svgElement('text', {
        x,
        y: plot.height - 14,
        'text-anchor': index === 0 ? 'start' : 'end',
        class: 'chart-axis-label',
      });
      label.textContent = formatDate(point.timestamp, true);
      grid.append(label);
    });

    [
      { points: goldPoints, className: 'chart-line-gold' },
      { points: silverPoints, className: 'chart-line-silver' },
    ].forEach(({ points, className }) => {
      const pathData = points.map((point, index) => {
        const command = index === 0 ? 'M' : 'L';
        return `${command} ${xForIndex(index, points.length).toFixed(2)} ${yForChange(point.change).toFixed(2)}`;
      }).join(' ');
      lines.append(svgElement('path', { d: pathData, class: className }));
    });

    goldSummary.textContent = formatChange(goldPoints[goldPoints.length - 1].change);
    silverSummary.textContent = formatChange(silverPoints[silverPoints.length - 1].change);
  }

  function showTooltip(event) {
    if (!series) {
      return;
    }

    const bounds = chart.getBoundingClientRect();
    const horizontalRatio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const indexFor = (points) => Math.round(horizontalRatio * (points.length - 1));
    const gold = series.gold[indexFor(series.gold)];
    const silver = series.silver[indexFor(series.silver)];

    tooltip.textContent = [
      formatDate(Math.max(gold.timestamp, silver.timestamp), true),
      `Gold reference: $${gold.price.toFixed(2)} (${formatChange(gold.change)})`,
      `Silver reference: $${silver.price.toFixed(2)} (${formatChange(silver.change)})`,
    ].join(' · ');

    const containerBounds = chart.parentElement.getBoundingClientRect();
    tooltip.style.left = `${Math.min(containerBounds.width - tooltip.offsetWidth - 10, Math.max(10, event.clientX - containerBounds.left))}px`;
    tooltip.hidden = false;
  }

  async function loadRange(range) {
    if (!rangeLabels[range]) {
      return;
    }

    if (activeRequest) {
      activeRequest.abort();
    }
    activeRequest = new AbortController();
    section.querySelectorAll('[data-range]').forEach((button) => {
      const isSelected = button.dataset.range === range;
      button.classList.toggle('is-active', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });

    series = null;
    grid.replaceChildren();
    lines.replaceChildren();
    tooltip.hidden = true;
    retryButton.hidden = true;
    goldSummary.textContent = '—';
    silverSummary.textContent = '—';
    status.textContent = `Loading ${rangeLabels[range]} of historical market data…`;

    try {
      const response = await fetch(`${section.dataset.apiUrl}?range=${encodeURIComponent(range)}`, {
        signal: activeRequest.signal,
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Historical market data could not be loaded.');
      }

      if (!Array.isArray(data.gold) || !Array.isArray(data.silver) || data.gold.length < 2 || data.silver.length < 2) {
        throw new Error('Historical market data is incomplete for this period.');
      }

      series = {
        gold: indexedPoints(data.gold),
        silver: indexedPoints(data.silver),
      };
      drawChart(series.gold, series.silver);
      const latestTimestamp = Math.max(
        series.gold[series.gold.length - 1].timestamp,
        series.silver[series.silver.length - 1].timestamp,
      );
      status.textContent = `${rangeLabels[range]} shown · reference data through ${formatDate(latestTimestamp, true)}.`;
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Historical metal performance could not be loaded:', error);
      status.textContent = error.message || 'Historical market data could not be loaded. Please try again.';
      retryButton.hidden = false;
    }
  }

  chart.addEventListener('pointermove', showTooltip);
  chart.addEventListener('pointerleave', () => {
    tooltip.hidden = true;
  });
  section.querySelectorAll('[data-range]').forEach((button) => {
    button.addEventListener('click', () => loadRange(button.dataset.range));
  });
  retryButton.addEventListener('click', () => {
    const selected = section.querySelector('[data-range][aria-pressed="true"]');
    loadRange(selected ? selected.dataset.range : '1y');
  });

  loadRange('1y');
})();
