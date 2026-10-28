// ==========================================================================
//  OBSERVATORIO GLOBAL DE CULTIVOS — orquestación
//
//  Flujo: clic en el globo → proxy PHP → cuatro APIs → datos normalizados →
//  traducción a parámetros → motor de crecimiento de la Práctica 05 →
//  idoneidad, reglas y curva de biomasa.
// ==========================================================================

const App = {

    especies: [],
    especie: null,
    sitio: null,          // el último punto consultado
    slots: { A: null, B: null },

    async iniciar() {
        this.cachearNodos();
        this.conectarEventos();

        this.especies = await (await fetch('datos/especies.json')).json();
        this.llenarSelector();

        Grafica.iniciar(document.getElementById('g-biomasa'));

        await Globo.iniciar(document.getElementById('globo'), 'datos/paises.json');
        Globo.onClic = coord => this.consultar(coord.lat, coord.lon);

        this.n.estado.textContent = `Globo listo · ${Globo.nPaises} países`;
        this.n.estado.className = 'chip ok';
    },

    cachearNodos() {
        const id = x => document.getElementById(x);
        this.n = {
            estado: id('estado'), selEspecie: id('sel-especie'),
            buscador: id('buscador'), resultados: id('resultados-busqueda'),
            panel: id('panel-sitio'), titulo: id('sitio-titulo'),
            coords: id('sitio-coords'), medidor: id('medidor'),
            marca: id('medidor-marca'), nivel: id('sitio-nivel'),
            tablaDatos: id('tabla-datos'), traduccion: id('traduccion'),
            avisoSim: id('aviso-simulacion'),
            decisiones: id('decisiones'), ranking: id('ranking'),
            comparacion: id('comparacion'), veredicto: id('veredicto-ab'),
            cargando: id('cargando')
        };
    },

    conectarEventos() {
        this.n.selEspecie.addEventListener('change', () => {
            this.especie = this.especies.find(e => e.id === +this.n.selEspecie.value);
            if (this.sitio) this.consultar(this.sitio.lat, this.sitio.lon);
        });

        document.getElementById('btn-buscar').addEventListener('click', () => this.buscar());
        this.n.buscador.addEventListener('keydown', e => {
            if (e.key === 'Enter') this.buscar();
        });

        document.getElementById('btn-slot-a').addEventListener('click', () => this.fijar('A'));
        document.getElementById('btn-slot-b').addEventListener('click', () => this.fijar('B'));
        document.getElementById('btn-limpiar').addEventListener('click', () => this.limpiar());

        document.getElementById('btn-ocurrencias').addEventListener('click', () => this.verOcurrencias());
    },

    llenarSelector() {
        this.n.selEspecie.innerHTML = this.especies
            .map(e => `<option value="${e.id}">${e.nombre_comun} — ${e.nombre_cientifico}</option>`)
            .join('');
        this.especie = this.especies[0];
    },

    ocupado(si, texto = 'Consultando APIs…') {
        this.n.cargando.textContent = texto;
        this.n.cargando.classList.toggle('oculto', !si);
    },

    // ----------------------------------------------------------------------
    //  Consulta de un punto
    // ----------------------------------------------------------------------
    async consultar(lat, lon) {
        this.ocupado(true);
        Globo.marcar('actual', lat, lon, 0x5fd08a);

        try {
            const datos = await Api.sitio(lat, lon, this.especie.nombre_cientifico);
            this.sitio = { lat, lon, ...datos };
            this.pintarSitio();

        } catch (e) {
            this.n.panel.classList.remove('oculto');
            this.n.titulo.textContent = 'No se pudo consultar';
            this.n.coords.textContent = e.message;
        } finally {
            this.ocupado(false);
        }
    },

    pintarSitio() {
        const s = this.sitio;
        const esp = this.especie;

        this.n.panel.classList.remove('oculto');

        const lugar = s.lugar || {};
        this.n.titulo.textContent = lugar.pais || 'Punto en el océano';
        this.n.coords.innerHTML =
            `${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°`
            + (lugar.altitud_m !== null && lugar.altitud_m !== undefined
                ? ` · ${lugar.altitud_m} m de altitud` : '')
            + (lugar.zona_horaria ? ` · ${lugar.zona_horaria}` : '');

        // --- Idoneidad ---
        const ev = Idoneidad.evaluar(s, esp);
        this.evaluacion = ev;

        // Un sitio sin clima no recibe nota. Ver un 0 y ver un "sin datos"
        // llevan a decisiones distintas, y la barra tiene que distinguirlos.
        if (ev.total === null) {
            this.n.marca.style.width = '0%';
            this.n.marca.className = 'relleno';
            this.n.nivel.textContent = 'Sin datos suficientes para puntuar este punto';
            this.n.nivel.className = 'nivel sin-datos';
        } else {
            this.n.marca.style.width = ev.total + '%';
            this.n.marca.className = 'relleno ' + ev.nivel;
            this.n.nivel.textContent = `${ev.total} / 100 · ${ev.nivel}`;
            this.n.nivel.className = 'nivel ' + ev.nivel;
        }

        this.pintarDatos(s, ev);
        this.pintarTraduccion(ev.cfg);
        this.pintarDecisiones(Idoneidad.reglas(s, esp, ev));
        this.pintarRanking(s);
        this.simular(ev.cfg);
    },

    /** Tabla con el dato crudo de cada API y de dónde salió. */
    pintarDatos(s, ev) {
        const filas = [];
        const fila = (grupo, campo, valor, unidad = '') => filas.push(
            `<tr><td class="grupo">${grupo}</td><td>${campo}</td>
             <td class="valor">${valor === null || valor === undefined ? '—' : valor} ${unidad}</td></tr>`);

        if (s.clima) {
            fila('Clima', 'Temperatura media', s.clima.temp_media_c, '°C');
            fila('', 'Lluvia anual', s.clima.lluvia_anual_mm, 'mm');
            fila('', 'Evapotranspiración (ET0)', s.clima.et0_anual_mm, 'mm');
            fila('', 'Índice de aridez', s.clima.indice_aridez);
            fila('', 'Radiación solar', s.clima.radiacion_mj_m2_dia, 'MJ/m²/día');
            fila('', 'Días de helada al año', s.clima.dias_helada_anio);
            fila('', 'Días sobre 35 °C', s.clima.dias_sobre_35_anio);
        }
        if (s.suelo) {
            fila('Suelo', 'pH', s.suelo.ph);
            fila('', 'Textura', s.suelo.textura || '—');
            fila('', 'Arcilla / arena', `${s.suelo.arcilla_pct} / ${s.suelo.arena_pct}`, '%');
            fila('', 'Carbono orgánico', s.suelo.carbono_organico_g_kg, 'g/kg');
        }
        if (s.biodiversidad) {
            fila('GBIF', 'Nombre aceptado', s.biodiversidad.aceptado);
            fila('', 'Registros en el mundo',
                 (s.biodiversidad.registros_mundo || 0).toLocaleString('es'));
            fila('', 'Registros en 550 km',
                 (s.biodiversidad.registros_region ?? 0).toLocaleString('es'));
        }

        const fallos = (s.fallos || []).map(f =>
            `<div class="aviso aviso-amarillo">Sin datos de <b>${f.fuente}</b>: ${f.error}</div>`).join('');

        this.n.tablaDatos.innerHTML = fallos +
            (filas.length ? `<table class="tabla">${filas.join('')}</table>`
                          : '<p class="nota">Ninguna fuente devolvió datos para este punto.</p>');
    },

    /** Cómo se convirtió cada dato real en un parámetro del simulador. */
    pintarTraduccion(cfg) {
        const o = cfg.origen;
        this.n.traduccion.innerHTML = `
            <table class="tabla">
                <tr><td>Temperatura</td><td class="valor">${cfg.temperatura} °C</td>
                    <td class="nota">${o.temperatura}</td></tr>
                <tr><td>Agua</td><td class="valor">${cfg.agua} %</td>
                    <td class="nota">${o.agua}</td></tr>
                <tr><td>Luz</td><td class="valor">${cfg.luz} %</td>
                    <td class="nota">${o.luz}</td></tr>
                <tr><td>Nutrientes</td><td class="valor">${cfg.nutrientes} %</td>
                    <td class="nota">${o.nutrientes}</td></tr>
                <tr><td>CO₂</td><td class="valor">${cfg.co2} ppm</td>
                    <td class="nota">media atmosférica actual</td></tr>
            </table>`;
    },

    pintarDecisiones(reglas) {
        const icono = { critico: '🔴', aviso: '🟡', info: '🔵' };

        this.n.decisiones.innerHTML = reglas.map(r => `
            <div class="item ${r.severidad}">
                <span class="icono">${icono[r.severidad]}</span>
                <div>
                    <div>${r.mensaje}</div>
                    ${r.accion ? `<div class="nota">${r.accion}</div>` : ''}
                </div>
            </div>`).join('');
    },

    /** Las seis especies ordenadas por idoneidad en este mismo sitio. */
    pintarRanking(s) {
        const lista = Idoneidad.ranking(s, this.especies);

        this.n.ranking.innerHTML = `<table class="tabla">
            <thead><tr><th>#</th><th>Especie</th><th>Idoneidad</th><th>Clima</th><th>Suelo</th></tr></thead>
            <tbody>${lista.map((r, i) => `
                <tr class="${r.especie.id === this.especie.id ? 'destacada' : ''}">
                    <td>${r.total === null ? '—' : i + 1}</td>
                    <td>${r.especie.nombre_comun}</td>
                    <td class="valor"><b class="${r.nivel}">${r.total ?? 'sin datos'}</b></td>
                    <td class="valor">${r.climatica ?? '—'}</td>
                    <td class="valor">${r.edafica ?? '—'}</td>
                </tr>`).join('')}</tbody></table>`;
    },

    /** Lanza el motor de la Práctica 05 con los parámetros de este lugar. */
    simular(cfg) {
        this.sim = Motor.simular(cfg);

        // Cuando falta una fuente, el traductor rellena con los óptimos de la
        // especie. La curva entonces describe la planta en condiciones
        // ideales, no en este sitio. Sin este aviso, los 354 g de un punto sin
        // datos se leen como una predicción.
        const supuestos = Object.entries(cfg.origen)
            .filter(([, t]) => t.startsWith('sin dato'))
            .map(([k]) => k);

        this.n.avisoSim.classList.toggle('oculto', supuestos.length === 0);
        if (supuestos.length) {
            this.n.avisoSim.innerHTML =
                `Esta curva <b>no es una predicción para este lugar</b>: faltaron datos de `
                + `${supuestos.join(', ')} y se usaron los valores óptimos de `
                + `${this.especie.nombre_comun}. Sirve como referencia de lo que daría la `
                + `especie en condiciones ideales.`;
        }

        Grafica.dibujar([{
            nombre: `${this.especie.nombre_comun} aquí`,
            color: Grafica.COLORES.A,
            mediciones: this.sim.mediciones
        }]);

        document.getElementById('kpi-biomasa').textContent =
            this.sim.resumen.biomasa_final + ' g';
        document.getElementById('kpi-madurez').textContent =
            this.sim.resumen.dias_a_madurez === null
                ? 'no madura' : 'día ' + this.sim.resumen.dias_a_madurez;
        document.getElementById('kpi-estres').textContent =
            this.sim.resumen.estres_promedio + ' / 100';
    },

    // ----------------------------------------------------------------------
    //  Ocurrencias de GBIF sobre el globo
    // ----------------------------------------------------------------------
    verOcurrencias() {
        const bio = this.sitio && this.sitio.biodiversidad;
        if (!bio || !bio.puntos.length) {
            this.n.estado.textContent = 'Sin ocurrencias que pintar';
            return;
        }

        const n = Globo.pintarOcurrencias(bio.puntos);
        this.n.estado.textContent =
            `${n} ocurrencias de ${bio.aceptado} en el globo`;
        this.n.estado.className = 'chip ok';
    },

    // ----------------------------------------------------------------------
    //  Comparación A/B entre dos puntos del mundo
    // ----------------------------------------------------------------------
    fijar(letra) {
        if (!this.sitio || !this.evaluacion) return;

        this.slots[letra] = {
            sitio: this.sitio,
            evaluacion: this.evaluacion,
            sim: this.sim,
            especie: this.especie
        };

        Globo.marcar(letra, this.sitio.lat, this.sitio.lon,
                     letra === 'A' ? 0x3987e5 : 0xd95926);

        this.pintarComparacion();
    },

    limpiar() {
        this.slots = { A: null, B: null };
        Globo.quitarMarcador('A');
        Globo.quitarMarcador('B');
        Globo.limpiarArcos();
        Globo.limpiarOcurrencias();
        this.pintarComparacion();
    },

    pintarComparacion() {
        const { A, B } = this.slots;

        if (!A && !B) {
            this.n.comparacion.innerHTML =
                '<p class="nota">Consulta un punto y pulsa «Fijar como A». Luego otro y «Fijar como B».</p>';
            this.n.veredicto.textContent = '';
            Grafica.dibujar(this.sim ? [{
                nombre: this.especie.nombre_comun, color: Grafica.COLORES.A,
                mediciones: this.sim.mediciones
            }] : []);
            return;
        }

        const tarjeta = (letra, s) => {
            if (!s) return `<div class="tarjeta vacia">Sin ${letra}</div>`;
            const nombre = (s.sitio.lugar && s.sitio.lugar.pais) || 'Océano';
            return `
                <div class="tarjeta">
                    <h4><span class="marca" style="background:${
                        letra === 'A' ? Grafica.COLORES.A : Grafica.COLORES.B}"></span>
                        ${letra} — ${nombre}</h4>
                    <p class="nota">${s.sitio.lat.toFixed(2)}°, ${s.sitio.lon.toFixed(2)}° ·
                       ${s.especie.nombre_comun}</p>
                    <dl>
                        <dt>Idoneidad</dt>
                        <dd class="${s.evaluacion.nivel}">${s.evaluacion.total ?? 'sin datos'}</dd>
                        <dt>Clima / Suelo</dt>
                        <dd>${s.evaluacion.climatica ?? '—'} / ${s.evaluacion.edafica ?? '—'}</dd>
                        <dt>Biomasa final</dt><dd>${s.sim.resumen.biomasa_final} g</dd>
                        <dt>Madurez</dt>
                        <dd>${s.sim.resumen.dias_a_madurez === null
                            ? 'no madura' : 'día ' + s.sim.resumen.dias_a_madurez}</dd>
                        <dt>Estrés</dt><dd>${s.sim.resumen.estres_promedio}</dd>
                    </dl>
                </div>`;
        };

        this.n.comparacion.innerHTML = tarjeta('A', A) + tarjeta('B', B);

        if (A && B) {
            Globo.arco({ lat: A.sitio.lat, lon: A.sitio.lon },
                       { lat: B.sitio.lat, lon: B.sitio.lon });

            Grafica.dibujar([
                { nombre: 'A', color: Grafica.COLORES.A, mediciones: A.sim.mediciones },
                { nombre: 'B', color: Grafica.COLORES.B, mediciones: B.sim.mediciones }
            ]);

            this.n.veredicto.innerHTML = this.veredicto(A, B);
        }
    },

    /**
     * Veredicto de la comparación.
     * Se decide por idoneidad y no solo por biomasa, porque la biomasa no ve
     * el suelo ni el riesgo de heladas: dos sitios pueden dar la misma curva
     * y uno ser inviable.
     */
    veredicto(A, B) {
        const nombre = s => (s.sitio.lugar && s.sitio.lugar.pais) || 'el punto marcado';

        // Si a alguno le faltan datos no se declara ganador. Comparar una nota
        // contra un hueco es exactamente como se fabrica una conclusión falsa.
        const sinNota = [['A', A], ['B', B]].filter(([, s]) => s.evaluacion.total === null);
        if (sinNota.length) {
            return `<b>Comparación no concluyente.</b> No hay idoneidad calculable para
                    ${sinNota.map(([l]) => l).join(' y ')}
                    (${sinNota.map(([, s]) => s.evaluacion.motivo).join(' ')})
                    Las curvas de crecimiento que se dibujan abajo usan los óptimos de la
                    especie donde faltó el dato, así que sirven de ilustración y no de
                    comparación.`;
        }

        const dif = +(A.evaluacion.total - B.evaluacion.total).toFixed(1);

        if (Math.abs(dif) < 5) {
            return `<b>Empate técnico.</b> ${nombre(A)} y ${nombre(B)} tienen idoneidad
                    ${A.evaluacion.total} y ${B.evaluacion.total} para
                    ${A.especie.nombre_comun}: la diferencia está dentro del ruido
                    de los datos. Decide por logística o por costo.`;
        }

        const g = dif > 0 ? A : B, p = dif > 0 ? B : A;
        const difBio = +(g.sim.resumen.biomasa_final - p.sim.resumen.biomasa_final).toFixed(1);

        return `<b>Gana ${nombre(g)}</b> con ${g.evaluacion.total} frente a
                ${p.evaluacion.total} de idoneidad para ${g.especie.nombre_comun}
                (${Math.abs(dif)} puntos).
                ${difBio > 0 ? `La simulación le da ${difBio} g más de biomasa. ` : ''}
                ${Idoneidad.explicarLimitante(p).replace('El factor', 'En el sitio perdedor, el factor')}`;
    },

    // ----------------------------------------------------------------------
    //  Búsqueda de lugares por nombre (geocodificación directa)
    // ----------------------------------------------------------------------
    async buscar() {
        const q = this.n.buscador.value.trim();
        if (q.length < 2) return;

        this.ocupado(true, 'Buscando lugar…');
        try {
            const d = await Api.buscar(q);

            this.n.resultados.innerHTML = d.lugares.length
                ? d.lugares.map(l => `
                    <button class="resultado" data-lat="${l.lat}" data-lon="${l.lon}">
                        ${l.nombre}<span class="nota">${[l.region, l.pais].filter(Boolean).join(', ')}</span>
                    </button>`).join('')
                : '<p class="nota">Sin resultados.</p>';

            this.n.resultados.querySelectorAll('.resultado').forEach(b => {
                b.addEventListener('click', () => {
                    const lat = +b.dataset.lat, lon = +b.dataset.lon;
                    Globo.irA(lat, lon);
                    this.consultar(lat, lon);
                    this.n.resultados.innerHTML = '';
                });
            });

        } catch (e) {
            this.n.resultados.innerHTML = `<p class="nota">${e.message}</p>`;
        } finally {
            this.ocupado(false);
        }
    }
};

window.addEventListener('DOMContentLoaded', () => App.iniciar());
