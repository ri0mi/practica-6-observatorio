// ==========================================================================
//  MOTOR BIOINFORMÁTICO
//  Convierte una configuración ambiental en una serie temporal de mediciones,
//  un conjunto de KPIs y una lista de decisiones agronómicas.
// ==========================================================================

const Motor = {

    // Peso de cada variable en el estrés total. El agua y la temperatura
    // pesan más porque son las que matan el cultivo; la luz y los nutrientes
    // lo frenan sin llegar a tanto.
    PESOS: { hidrico: 0.32, termico: 0.30, luminico: 0.20, nutricional: 0.18 },

    UMBRAL_AVISO: 30,
    UMBRAL_CRITICO: 60,

    /**
     * Índice de estrés por variable, de 0 a 100.
     * Es la desviación absoluta respecto al óptimo de la especie, dividida
     * entre la tolerancia de esa especie para esa variable. Una tolerancia
     * grande significa que el cultivo aguanta desviaciones grandes sin sufrir.
     */
    estresDe(valor, optimo, tolerancia) {
        if (!tolerancia) return 0;
        return Math.min(100, Math.abs(valor - optimo) / tolerancia * 100);
    },

    calcularEstres(amb, esp) {
        const hidrico     = this.estresDe(amb.agua,        esp.agua_optima,       esp.tol_agua);
        const termico     = this.estresDe(amb.temperatura, esp.temp_optima,       esp.tol_temp);
        const luminico    = this.estresDe(amb.luz,         esp.luz_optima,        esp.tol_luz);
        const nutricional = this.estresDe(amb.nutrientes,  esp.nutrientes_optimo, esp.tol_nutrientes);

        const ponderado = hidrico     * this.PESOS.hidrico
                        + termico     * this.PESOS.termico
                        + luminico    * this.PESOS.luminico
                        + nutricional * this.PESOS.nutricional;

        // Ley del mínimo de Liebig: el factor más limitante gobierna el
        // crecimiento. Un promedio ponderado solo diluiría una variable letal
        // (temperatura de 45 °C con todo lo demás perfecto saldría en 30/100),
        // así que el total nunca baja del 65 % de la peor variable.
        const peor = Math.max(hidrico, termico, luminico, nutricional);
        const total = Math.max(ponderado, peor * 0.65);

        return {
            hidrico:     +hidrico.toFixed(2),
            termico:     +termico.toFixed(2),
            luminico:    +luminico.toFixed(2),
            nutricional: +nutricional.toFixed(2),
            total:       +total.toFixed(2)
        };
    },

    /**
     * El CO₂ no genera estrés: modifica la capacidad de carga.
     * Más CO₂ del óptimo fertiliza y sube el techo de biomasa; menos lo baja.
     * El efecto se acota entre −30 % y +25 %, que es el rango razonable
     * reportado para enriquecimiento en invernadero.
     */
    kEfectiva(k, co2, co2Optimo, estresTotal = 0) {
        const factorCo2 = 1 + 0.25 * (co2 - co2Optimo) / co2Optimo;

        // El estrés no solo retrasa: también recorta el rendimiento final.
        // Un tomate con déficit hídrico no tarda más en dar lo mismo, da menos.
        // Con estrés 100 la capacidad de carga cae al 55 %.
        const factorEstres = 1 - 0.45 * estresTotal / 100;

        return k * Math.min(1.25, Math.max(0.70, factorCo2)) * factorEstres;
    },

    /**
     * El estrés no cambia el techo, cambia la velocidad: una planta estresada
     * tarda más en llegar al mismo tamaño. Con estrés 100 la tasa cae al 15 %.
     */
    rEfectiva(r, estresTotal) {
        return r * (1 - 0.85 * estresTotal / 100);
    },

    /**
     * Morfología a partir de la biomasa.
     * La fracción de capacidad de carga ya alcanzada gobierna todo lo visible:
     * altura, número de hojas y número de ramas. Los exponentes hacen que la
     * altura corra por delante de la biomasa (la planta se estira antes de
     * engordar) y que las hojas aparezcan antes que las ramas.
     */
    morfologia(fraccion, esp) {
        const f = Math.min(1, Math.max(0, fraccion));
        return {
            altura:  +(esp.altura_max_u * Math.pow(f, 0.75)).toFixed(3),
            n_hojas: Math.round(Math.pow(f, 0.6) * 18),
            n_ramas: Math.round(Math.pow(f, 0.5) * esp.n_ramas)
        };
    },

    /**
     * Ejecuta la simulación completa día por día.
     * Devuelve la serie de mediciones, los agregados y las decisiones.
     */
    /**
     * Calcula un tramo de la curva, del día `desde` al final del ciclo.
     *
     * Es el bucle que antes vivía dentro de simular(). Se separó para poder
     * reutilizarlo al intervenir a mitad de ciclo: ahí el tramo arranca en el
     * día del cambio y con la biomasa ya acumulada como nuevo N₀.
     *
     * El tiempo que recibe el modelo es RELATIVO al inicio del tramo
     * (`dia - desde`): la fórmula no sabe nada de lo que pasó antes, solo que
     * parte de N₀ y le quedan `dias - desde` días por delante.
     */
    tramo({ cfg, esp, estres, K, r, N0, desde = 0, biomasaPrevia = null }) {
        const modelo = Modelos[cfg.modelo] ? cfg.modelo : 'logistico';
        const params = { N0, K, r, dias: Math.max(1, cfg.dias - desde) };

        const mediciones = [];
        let anterior = biomasaPrevia;

        for (let dia = desde; dia <= cfg.dias; dia++) {
            const biomasa = Math.max(0, Modelos[modelo](dia - desde, params));
            const morf = this.morfologia(biomasa / K, esp);

            // Índice de crecimiento relativo: cuánto crece por unidad de lo
            // que ya tiene. ICR = (ln B₂ − ln B₁) / (t₂ − t₁)
            let icr = 0;
            if (anterior !== null && anterior > 0 && biomasa > 0) {
                icr = (Math.log(biomasa) - Math.log(anterior)) / 1;
            }
            anterior = biomasa;

            mediciones.push({
                dia,
                biomasa: +biomasa.toFixed(3),
                altura: morf.altura,
                n_hojas: morf.n_hojas,
                n_ramas: morf.n_ramas,
                estres_hidrico: estres.hidrico,
                estres_termico: estres.termico,
                estres_luminico: estres.luminico,
                estres_nutricional: estres.nutricional,
                estres_total: estres.total,
                icr: +icr.toFixed(5)
            });
        }

        return mediciones;
    },

    /**
     * Resumen de una corrida a partir de su serie completa.
     * Se calcula sobre las mediciones y no sobre los parámetros, para que
     * siga siendo correcto cuando la curva está partida en varios tramos.
     */
    resumir(mediciones, cfg, K, r) {
        const ultima = mediciones[mediciones.length - 1];

        // La madurez se busca en toda la serie: si una intervención sube el
        // techo, el día en que se alcanza el 95 % cambia.
        let diasAMadurez = null;
        for (const m of mediciones) {
            if (m.biomasa >= 0.95 * K) { diasAMadurez = m.dia; break; }
        }

        const sumaIcr = mediciones.reduce((a, m) => a + m.icr, 0);
        const sumaEstres = mediciones.reduce((a, m) => a + m.estres_total, 0);
        const diasRef = diasAMadurez || cfg.dias;

        return {
            biomasa_final: +ultima.biomasa.toFixed(2),
            altura_final: ultima.altura,
            hojas_final: ultima.n_hojas,
            ramas_final: ultima.n_ramas,
            dias_a_madurez: diasAMadurez,
            // Promedio sobre la serie: con intervenciones, el estrés deja de
            // ser un número único y pasa a ser el promedio de lo vivido.
            estres_promedio: +(sumaEstres / mediciones.length).toFixed(1),
            icr_promedio: +(sumaIcr / Math.max(1, cfg.dias)).toFixed(5),
            eficiencia: +(ultima.biomasa / diasRef).toFixed(4),
            k_efectiva: +K.toFixed(2),
            r_efectiva: +r.toFixed(4)
        };
    },

    simular(cfg) {
        const esp = cfg.especie;
        const estres = this.calcularEstres(cfg, esp);
        const K  = this.kEfectiva(cfg.k, cfg.co2, esp.co2_optimo, estres.total);
        const r  = this.rEfectiva(cfg.r, estres.total);
        const N0 = Math.max(0.001, +esp.biomasa_inicial);

        const mediciones = this.tramo({ cfg, esp, estres, K, r, N0 });
        const resumen = this.resumir(mediciones, cfg, K, r);

        return {
            config: cfg,
            estres,
            mediciones,
            resumen,
            decisiones: this.decidir(cfg, esp, estres, resumen),
            intervenciones: []
        };
    },

    /**
     * INTERVENCIÓN A MITAD DE CICLO
     *
     * Toma una corrida en marcha y la continúa desde `diaCorte` con otras
     * condiciones. Lo ya vivido se conserva tal cual: solo se recalcula el
     * futuro.
     *
     * La biomasa acumulada hasta el día del corte pasa a ser el nuevo N₀, y
     * con las condiciones nuevas se recalculan el estrés, K_efectiva y
     * r_efectiva. Por eso la curva resultante no es la de ninguna corrida
     * simple: está partida, y ahí es donde se ve el efecto del cambio.
     *
     * Devuelve una corrida nueva; no modifica la que recibe.
     */
    continuar(simPrevia, cfgNueva, diaCorte) {
        const esp = cfgNueva.especie;

        const corte = Math.max(0, Math.min(diaCorte, cfgNueva.dias));
        const previas = simPrevia.mediciones.filter(m => m.dia < corte);
        const enCorte = simPrevia.mediciones.find(m => m.dia === corte)
                     || simPrevia.mediciones[simPrevia.mediciones.length - 1];

        // Si el corte cae en el día 0 no hay nada que conservar: es una
        // corrida nueva y punto.
        if (corte === 0 || !enCorte) return this.simular(cfgNueva);

        const estres = this.calcularEstres(cfgNueva, esp);
        const K = this.kEfectiva(cfgNueva.k, cfgNueva.co2, esp.co2_optimo, estres.total);
        const r = this.rEfectiva(cfgNueva.r, estres.total);
        const N0 = Math.max(0.001, enCorte.biomasa);

        const nuevas = this.tramo({
            cfg: cfgNueva, esp, estres, K, r, N0,
            desde: corte,
            biomasaPrevia: previas.length ? previas[previas.length - 1].biomasa : null
        });

        const mediciones = previas.concat(nuevas);
        const resumen = this.resumir(mediciones, cfgNueva, K, r);

        // Las decisiones anteriores al corte describen lo que ya pasó y se
        // conservan; las nuevas se emiten fechadas en el día de la intervención.
        const anteriores = simPrevia.decisiones.filter(d => d.dia < corte);
        const nuevasDec = this.decidir(cfgNueva, esp, estres, resumen, corte);

        return {
            config: cfgNueva,
            estres,
            mediciones,
            resumen,
            decisiones: anteriores.concat(nuevasDec),
            intervenciones: (simPrevia.intervenciones || []).concat([{
                dia: corte,
                biomasa_al_cambiar: +enCorte.biomasa.toFixed(2),
                cambios: this.diferencias(simPrevia.config, cfgNueva),
                k_anterior: simPrevia.resumen.k_efectiva,
                k_nueva: resumen.k_efectiva,
                estres_anterior: simPrevia.estres.total,
                estres_nuevo: estres.total
            }])
        };
    },

    /** Etiquetas de las variables que el usuario puede tocar. */
    VARIABLES: {
        modelo:      { nombre: 'Modelo',       unidad: ''     },
        r:           { nombre: 'Tasa r',       unidad: ''     },
        k:           { nombre: 'Capacidad K',  unidad: 'g'    },
        dias:        { nombre: 'Ciclo',        unidad: 'días' },
        luz:         { nombre: 'Luz',          unidad: '%'    },
        agua:        { nombre: 'Agua',         unidad: '%'    },
        temperatura: { nombre: 'Temperatura',  unidad: '°C'   },
        nutrientes:  { nombre: 'Nutrientes',   unidad: '%'    },
        co2:         { nombre: 'CO₂',          unidad: 'ppm'  }
    },

    /** Qué cambió entre dos configuraciones, en texto legible. */
    diferencias(antes, despues) {
        return Object.keys(this.VARIABLES)
            .filter(k => String(antes[k]) !== String(despues[k]))
            .map(k => ({
                variable: k,
                nombre: this.VARIABLES[k].nombre,
                unidad: this.VARIABLES[k].unidad,
                antes: antes[k],
                despues: despues[k]
            }));
    },

    /**
     * Motor de decisiones. Traduce los índices de estrés en acciones concretas
     * y contesta las tres preguntas de la práctica: qué corregir, cuándo regar
     * y cuántos días faltan para la cosecha.
     */
    decidir(cfg, esp, estres, resumen, diaBase = 0) {
        const d = [];

        const severidad = v => v >= this.UMBRAL_CRITICO ? 'critico'
                             : v >= this.UMBRAL_AVISO   ? 'aviso'
                             : null;

        const revisar = (valorEstres, tipo, actual, optimo, unidad, nombre) => {
            const sev = severidad(valorEstres);
            if (!sev) return;

            const direccion = actual < optimo ? 'por debajo' : 'por encima';
            const delta = Math.abs(actual - optimo).toFixed(1);

            d.push({
                dia: diaBase,
                tipo,
                severidad: sev,
                mensaje: `${nombre} ${delta} ${unidad} ${direccion} del óptimo de ${esp.nombre_comun}. `
                       + `Índice de estrés ${valorEstres.toFixed(0)}/100.`,
                valor_sugerido: `${nombre.toLowerCase()}: ${optimo} ${unidad}`
            });
        };

        revisar(estres.hidrico,     'riego',       cfg.agua,        esp.agua_optima,       '%',   'Humedad');
        revisar(estres.termico,     'temperatura', cfg.temperatura, esp.temp_optima,       '°C',  'Temperatura');
        revisar(estres.luminico,    'luz',         cfg.luz,         esp.luz_optima,        '%',   'Luz');
        revisar(estres.nutricional, 'nutricion',   cfg.nutrientes,  esp.nutrientes_optimo, '%',   'Nutrientes');

        // CO₂: no estresa, pero conviene avisar si está limitando el techo
        if (cfg.co2 < esp.co2_optimo * 0.85) {
            d.push({
                dia: diaBase, tipo: 'co2', severidad: 'aviso',
                mensaje: `El CO₂ bajo recorta la capacidad de carga a ${resumen.k_efectiva} g.`,
                valor_sugerido: `co2: ${esp.co2_optimo} ppm`
            });
        }

        if (d.length === 0) {
            d.push({
                dia: diaBase, tipo: 'general', severidad: 'info',
                mensaje: `Condiciones dentro del rango óptimo para ${esp.nombre_cientifico}.`,
                valor_sugerido: null
            });
        }

        if (resumen.dias_a_madurez !== null) {
            d.push({
                dia: resumen.dias_a_madurez, tipo: 'cosecha', severidad: 'info',
                mensaje: `Alcanza el 95 % de la capacidad de carga el día ${resumen.dias_a_madurez}.`,
                valor_sugerido: `cosechar día ${resumen.dias_a_madurez}`
            });
        } else {
            d.push({
                dia: cfg.dias, tipo: 'cosecha', severidad: 'aviso',
                mensaje: `No alcanza la madurez en ${cfg.dias} días con estas condiciones. `
                       + `Alargar el ciclo o corregir el ambiente.`,
                valor_sugerido: `ciclo > ${cfg.dias} días`
            });
        }

        return d;
    },

    /**
     * Próxima acción recomendada en el día que se esté viendo.
     * Es lo que muestra el tablero de KPIs.
     */
    proximaAccion(sim, diaActual) {
        // Con intervenciones, las decisiones de un régimen anterior describen
        // algo que ya se corrigió. Solo cuentan las del régimen vigente, que
        // son las emitidas en la última intervención anterior a hoy (o en el
        // día 0 si todavía no se ha intervenido).
        const vigenteDesde = (sim.intervenciones || [])
            .filter(i => i.dia <= diaActual)
            .reduce((a, i) => Math.max(a, i.dia), 0);

        const delRegimen = sim.decisiones.filter(x => x.dia === vigenteDesde);

        const criticas = delRegimen.filter(x => x.severidad === 'critico');
        if (criticas.length) return criticas[0];

        const avisos = delRegimen.filter(x => x.severidad === 'aviso');
        if (avisos.length) return avisos[0];

        const madurez = sim.resumen.dias_a_madurez;
        if (madurez !== null && diaActual < madurez) {
            return {
                tipo: 'cosecha', severidad: 'info',
                mensaje: `Faltan ${madurez - diaActual} días para la cosecha.`
            };
        }

        return { tipo: 'general', severidad: 'info', mensaje: 'Sin acciones pendientes.' };
    },

    /**
     * Contribución de una parte de la planta a la biomasa total.
     * Reparto agronómico aproximado: el tallo sostiene, las hojas producen y
     * las flores acumulan. Se usa en el panel de información al seleccionar.
     */
    CONTRIBUCION: {
        // El orden importa: se devuelve la PRIMERA clave que sea prefijo del
        // nombre, así que lo específico va antes que lo general
        // ('Tallo principal' antes que 'Tallo', 'Pétalo exterior' antes que 'Pétalo').
        'Tallo principal': 0.26,
        'Macollo': 0.10,
        'Segmento del tallo': 0.05,
        'Tallo': 0.10,
        'Rama': 0.07,

        'Hoja acintada': 0.05,
        'Hoja del cogollo': 0.06,
        'Hoja externa': 0.07,
        'Hoja lineal': 0.035,
        'Hoja de la roseta': 0.05,
        'Hoja': 0.04,
        'Folíolo': 0.016,

        // Órganos de cosecha: es donde se acumula el grueso del rendimiento
        'Mazorca': 0.13,
        'Espiga': 0.07,
        'Grano': 0.005,
        'Arista': 0.001,
        'Fruto': 0.07,
        'Vaina': 0.05,
        'Silicua': 0.004,

        'Centro de la flor': 0.012,
        'Pétalo exterior': 0.012,
        'Pétalo interior': 0.010,
        'Pétalo': 0.004,
        'Flor': 0.012,
        'Penacho': 0.03,
        'Espiguilla del penacho': 0.004,
        'Estigmas': 0.004,
        'Bráctea': 0.012,
        'Sépalo': 0.003,
        'Nudo del tallo': 0.006,

        // Lo que no es planta no aporta biomasa
        'Guía': 0,
        'Maceta': 0,
        'Borde de la maceta': 0,
        'Sustrato': 0
    },

    contribucionDe(nombreParte, biomasaTotal) {
        const clave = Object.keys(this.CONTRIBUCION)
            .find(k => nombreParte.startsWith(k));

        if (clave === undefined) return null;

        return +(this.CONTRIBUCION[clave] * biomasaTotal).toFixed(2);
    }
};
