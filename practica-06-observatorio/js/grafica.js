// ==========================================================================
//  GRÁFICA DE BIOMASA (Chart.js)
//  Una sola forma: la curva de crecimiento simulada con las condiciones
//  reales del sitio. En modo comparación se superponen las dos ubicaciones.
// ==========================================================================

const Grafica = {

    // Paleta validada para daltonismo y contraste sobre el fondo #161b22
    COLORES: { A: '#3987e5', B: '#d95926' },

    iniciar(lienzo) {
        this.chart = new Chart(lienzo, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { right: 54 } },
                plugins: {
                    title: {
                        display: true, text: 'Biomasa simulada (g)',
                        color: '#c9d1d9', align: 'start',
                        font: { size: 12, weight: '600' }
                    },
                    legend: { display: false }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'día', color: '#8b98a5' },
                        ticks: { color: '#8b98a5', maxTicksLimit: 10 },
                        grid: { color: '#263241' }
                    },
                    y: {
                        title: { display: true, text: 'gramos', color: '#8b98a5' },
                        ticks: { color: '#8b98a5' },
                        grid: { color: '#263241' }
                    }
                }
            },
            // Etiqueta directa al final de cada línea: la identidad no debe
            // depender solo del color.
            plugins: [{
                id: 'etiquetasDirectas',
                afterDatasetsDraw(chart) {
                    const { ctx } = chart;
                    ctx.save();
                    ctx.font = '600 11px system-ui, sans-serif';
                    ctx.textBaseline = 'middle';
                    chart.data.datasets.forEach((ds, i) => {
                        const meta = chart.getDatasetMeta(i);
                        if (!meta.data.length) return;
                        const p = meta.data[meta.data.length - 1];
                        ctx.fillStyle = ds.borderColor;
                        ctx.fillText(' ' + ds.label, p.x + 4, p.y);
                    });
                    ctx.restore();
                }
            }]
        });
    },

    dibujar(series) {
        if (!this.chart) return;

        const masLarga = series.reduce(
            (a, s) => s.mediciones.length > a.length ? s.mediciones : a, []);

        this.chart.data.labels = masLarga.map(m => m.dia);
        this.chart.data.datasets = series.map(s => ({
            label: s.nombre,
            data: s.mediciones.map(m => m.biomasa),
            borderColor: s.color,
            backgroundColor: s.color + '22',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.25
        }));

        this.chart.update('none');
    }
};
