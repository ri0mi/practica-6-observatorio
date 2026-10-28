// ==========================================================================
//  CAPA DE DECISIÓN GEO-AGRONÓMICA
//
//  Aquí se cruza lo que dicen las APIs con lo que pide cada especie. Dos
//  trabajos distintos:
//
//    1. TRADUCIR. El motor de la Práctica 05 habla en porcentajes de luz,
//       agua y nutrientes. Las APIs hablan en MJ/m²/día, milímetros de lluvia
//       y gramos de carbono por kilo. Hay que convertir, y hay que decir con
//       qué criterio: una conversión sin justificar es un número inventado.
//
//    2. PUNTUAR. Un índice de idoneidad de 0 a 100 que combina clima, suelo
//       y evidencia de que la especie realmente crece por ahí.
// ==========================================================================

const Idoneidad = {

    // Pesos de los tres componentes. El clima manda porque es lo que más
    // varía entre dos puntos del planeta; la evidencia de GBIF pesa poco
    // porque mide esfuerzo de muestreo tanto como presencia real.
    PESOS: { climatica: 0.55, edafica: 0.30, evidencia: 0.15 },

    // Radiación diaria que se considera "luz al 100 %". Un día despejado de
    // verano en latitudes medias ronda los 28 MJ/m²; por encima de eso la
    // planta ya no gana nada, se satura la fotosíntesis.
    RADIACION_PLENA: 28,

    // Carbono orgánico que se considera suelo plenamente fértil. Un suelo
    // agrícola bueno anda por 20–30 g/kg; por debajo de 10 es pobre.
    SOC_FERTIL: 30,

    CO2_ATMOSFERICO: 420,

    // ----------------------------------------------------------------------
    //  1. De datos reales a parámetros del simulador
    // ----------------------------------------------------------------------

    /**
     * Convierte las mediciones de las APIs en la configuración que entiende
     * el motor de crecimiento de la Práctica 05.
     *
     * Devuelve además `origen`, que explica de dónde salió cada número. Sin
     * eso, el usuario ve un 63 % de agua y no tiene forma de saber si es un
     * dato o una suposición.
     */
    aParametros(clima, suelo, especie) {
        const origen = {};

        // --- Temperatura: directa, es el único dato que no hay que traducir.
        const temperatura = clima && clima.temp_media_c !== null
            ? clima.temp_media_c
            : especie.temp_optima;
        origen.temperatura = clima
            ? `media anual de ${clima.fuente}`
            : 'sin dato: se usa el óptimo de la especie';

        // --- Agua: del índice de aridez (lluvia / evapotranspiración).
        // Un índice de 1 significa que llueve exactamente lo que la atmósfera
        // es capaz de evaporar, que es una humedad de suelo cómoda. Se mapea
        // ese 1 a un 75 % de humedad, que es el riego óptimo típico.
        let agua = especie.agua_optima;
        if (clima && clima.indice_aridez !== null) {
            agua = Math.max(0, Math.min(100, clima.indice_aridez * 75));
            origen.agua = `índice de aridez ${clima.indice_aridez} `
                        + `(${clima.lluvia_anual_mm} mm de lluvia / ${clima.et0_anual_mm} mm de ET0)`;
        } else {
            origen.agua = 'sin dato: se usa el óptimo de la especie';
        }

        // --- Luz: radiación solar contra el techo de saturación.
        let luz = especie.luz_optima;
        if (clima && clima.radiacion_mj_m2_dia !== null) {
            luz = Math.max(0, Math.min(100,
                clima.radiacion_mj_m2_dia / this.RADIACION_PLENA * 100));
            origen.luz = `${clima.radiacion_mj_m2_dia} MJ/m²/día sobre `
                       + `${this.RADIACION_PLENA} de saturación`;
        } else {
            origen.luz = 'sin dato: se usa el óptimo de la especie';
        }

        // --- Nutrientes: del carbono orgánico del suelo, que es el mejor
        // indicador individual de fertilidad que da SoilGrids.
        let nutrientes = especie.nutrientes_optimo;
        if (suelo && suelo.carbono_organico_g_kg !== null) {
            nutrientes = Math.max(0, Math.min(100,
                suelo.carbono_organico_g_kg / this.SOC_FERTIL * 100));
            origen.nutrientes = `${suelo.carbono_organico_g_kg} g/kg de carbono orgánico `
                              + `(SoilGrids), sobre ${this.SOC_FERTIL} de referencia`;
        } else {
            origen.nutrientes = 'sin dato: se usa el óptimo de la especie';
        }

        return {
            especie,
            especie_id: especie.id,
            modelo: especie.modelo_default,
            r: +especie.r_default,
            k: +especie.k_default,
            dias: +especie.dias_madurez,
            luz: +luz.toFixed(1),
            agua: +agua.toFixed(1),
            temperatura: +temperatura.toFixed(1),
            nutrientes: +nutrientes.toFixed(1),
            co2: this.CO2_ATMOSFERICO,
            origen
        };
    },

    // ----------------------------------------------------------------------
    //  2. Puntuación de idoneidad
    // ----------------------------------------------------------------------

    /**
     * Clima: es el complemento del estrés que ya calcula el motor.
     *
     * Devuelve null si no hubo datos climáticos. Es importante que así sea:
     * cuando falta el clima, aParametros() rellena con los óptimos de la
     * especie, y entonces el estrés sale 0 y el sitio puntuaría 100. Un punto
     * del que no sabemos nada acabaría ganando todas las comparaciones. Sin
     * clima no hay nota, no hay nota perfecta.
     */
    puntuarClima(cfg, especie, hayClima) {
        if (!hayClima) return null;
        const estres = Motor.calcularEstres(cfg, especie);
        return { puntos: Math.max(0, 100 - estres.total), estres };
    },

    /**
     * Suelo: pH contra el óptimo de la especie, más si la textura está entre
     * las que tolera. Si no hay dato de suelo se devuelve null y el peso se
     * reparte entre los otros dos componentes, en vez de inventar un 50.
     */
    puntuarSuelo(suelo, especie) {
        if (!suelo || suelo.ph === null) return null;

        const desvio = Math.abs(suelo.ph - especie.ph_optimo);
        const porPh = Math.max(0, 100 - (desvio / especie.tol_ph) * 100);

        let porTextura = 60;   // textura desconocida: ni premio ni castigo
        if (suelo.textura) {
            porTextura = especie.texturas.includes(suelo.textura) ? 100 : 35;
        }

        return {
            puntos: +(porPh * 0.6 + porTextura * 0.4).toFixed(1),
            ph: +porPh.toFixed(1),
            textura: porTextura
        };
    },

    /**
     * Evidencia: cuántos registros de GBIF hay cerca.
     *
     * Se usa escala logarítmica porque la diferencia entre 0 y 100 registros
     * significa muchísimo más que entre 10.000 y 10.100. El tope son 5.000
     * registros en la ventana regional.
     *
     * ADVERTENCIA que hay que tener presente al leer esto: GBIF mide dónde
     * hay gente registrando, no solo dónde hay plantas. Europa aparece
     * densísima y buena parte de África vacía, y eso dice más del esfuerzo de
     * muestreo que de la biología. Por eso pesa solo 0.15.
     */
    puntuarEvidencia(bio) {
        if (!bio || bio.registros_region === null || bio.registros_region === undefined) return null;

        const n = bio.registros_region;
        const puntos = Math.min(100, Math.log10(n + 1) / Math.log10(5001) * 100);

        return { puntos: +puntos.toFixed(1), registros: n };
    },

    /**
     * Índice total.
     *
     * Se vuelve a aplicar la ley del mínimo de Liebig que ya está en el motor
     * de la Práctica 05: el total no puede superar en mucho al peor de sus
     * componentes. Un sitio con clima perfecto y suelo imposible no es un
     * sitio medianamente bueno, es un sitio malo.
     */
    evaluar(sitio, especie) {
        const hayClima = !!(sitio.clima && sitio.clima.temp_media_c !== null);
        const cfg = this.aParametros(sitio.clima, sitio.suelo, especie);

        const clima = this.puntuarClima(cfg, especie, hayClima);
        const suelo = this.puntuarSuelo(sitio.suelo, especie);
        const evidencia = this.puntuarEvidencia(sitio.biodiversidad);

        // El clima es obligatorio. Sin él no se emite nota: se dice que no se
        // sabe. Puntuar un sitio sin datos lo convertiría en el ganador de
        // cualquier comparación, que es justo la conclusión más peligrosa que
        // podría sacar alguien de esta herramienta.
        if (!clima) {
            return {
                total: null, nivel: 'sin datos',
                climatica: null,
                edafica: suelo ? suelo.puntos : null,
                evidencia: evidencia ? evidencia.puntos : null,
                estres: null, cfg, incompleto: true,
                motivo: 'No hay datos climáticos para este punto.'
            };
        }

        // Reparto de pesos solo entre los componentes que sí tienen dato.
        const partes = [
            { clave: 'climatica', valor: clima.puntos, peso: this.PESOS.climatica },
            { clave: 'edafica', valor: suelo ? suelo.puntos : null, peso: this.PESOS.edafica },
            { clave: 'evidencia', valor: evidencia ? evidencia.puntos : null, peso: this.PESOS.evidencia }
        ].filter(p => p.valor !== null);

        const pesoTotal = partes.reduce((a, p) => a + p.peso, 0);
        const ponderado = partes.reduce((a, p) => a + p.valor * p.peso, 0) / pesoTotal;

        // El techo de Liebig solo mira clima y suelo: la evidencia de GBIF es
        // un indicio, no un factor limitante. Que nadie haya registrado maíz
        // en un valle no impide que el maíz crezca ahí.
        const limitantes = [clima.puntos, suelo ? suelo.puntos : 100];
        const peor = Math.min(...limitantes);
        const total = Math.min(ponderado, peor * 1.25);

        return {
            total: +Math.max(0, Math.min(100, total)).toFixed(1),
            nivel: this.nivel(total),
            climatica: +clima.puntos.toFixed(1),
            edafica: suelo ? suelo.puntos : null,
            evidencia: evidencia ? evidencia.puntos : null,
            estres: clima.estres,
            cfg,
            incompleto: partes.length < 3,
            motivo: partes.length < 3
                ? 'Falta alguna fuente: la nota se reparte entre las disponibles.' : null
        };
    },

    nivel(v) {
        if (v === null) return 'sin datos';
        if (v >= 75) return 'excelente';
        if (v >= 55) return 'buena';
        if (v >= 35) return 'marginal';
        return 'desaconsejada';
    },

    // ----------------------------------------------------------------------
    //  3. Reglas geo-agronómicas
    //     El motor de decisiones de la Práctica 05 solo veía los deslizadores.
    //     Estas reglas ven el mundo real.
    // ----------------------------------------------------------------------
    reglas(sitio, especie, evaluacion) {
        const d = [];
        const clima = sitio.clima, suelo = sitio.suelo, bio = sitio.biodiversidad;

        // --- Riesgo agroclimático -----------------------------------------
        if (clima) {
            if (clima.indice_aridez !== null && clima.indice_aridez < 0.65) {
                const arido = clima.indice_aridez < 0.2;
                d.push({
                    severidad: arido ? 'critico' : 'aviso',
                    tipo: 'riego',
                    mensaje: `Estrés hídrico: índice de aridez ${clima.indice_aridez} `
                           + `(${arido ? 'zona árida' : 'zona seca'} según la FAO). `
                           + `Llueven ${clima.lluvia_anual_mm} mm y se evaporan ${clima.et0_anual_mm} mm.`,
                    accion: `Riego suplementario de al menos `
                          + `${Math.round(clima.et0_anual_mm - clima.lluvia_anual_mm)} mm al año.`
                });
            }

            if (clima.lluvia_anual_mm !== null && clima.lluvia_anual_mm > especie.lluvia_max_mm) {
                d.push({
                    severidad: 'aviso', tipo: 'drenaje',
                    mensaje: `${clima.lluvia_anual_mm} mm al año superan el máximo cómodo `
                           + `para ${especie.nombre_comun} (${especie.lluvia_max_mm} mm).`,
                    accion: 'Prever drenaje y vigilar enfermedades por exceso de humedad.'
                });
            }

            if (clima.dias_helada_anio > 5) {
                d.push({
                    severidad: clima.dias_helada_anio > 40 ? 'critico' : 'aviso',
                    tipo: 'temperatura',
                    mensaje: `${clima.dias_helada_anio} días de helada al año. `
                           + `El ciclo de ${especie.nombre_comun} dura ${especie.dias_madurez} días.`,
                    accion: 'Ajustar la fecha de siembra a la ventana libre de heladas.'
                });
            }

            if (clima.dias_sobre_35_anio > 15) {
                d.push({
                    severidad: 'aviso', tipo: 'temperatura',
                    mensaje: `${clima.dias_sobre_35_anio} días al año por encima de 35 °C. `
                           + `Por encima de ese umbral se aborta el cuajado en la mayoría de los cultivos.`,
                    accion: 'Sembrar fuera de la estación cálida o usar sombreo.'
                });
            }
        } else {
            d.push({ severidad: 'aviso', tipo: 'datos',
                     mensaje: 'Sin datos climáticos para este punto.',
                     accion: 'La idoneidad se calcula solo con las fuentes disponibles.' });
        }

        // --- Suelo ---------------------------------------------------------
        if (suelo && suelo.ph !== null) {
            const desvio = suelo.ph - especie.ph_optimo;

            if (Math.abs(desvio) > especie.tol_ph) {
                d.push({
                    severidad: 'critico', tipo: 'suelo',
                    mensaje: `pH ${suelo.ph} frente al óptimo ${especie.ph_optimo} de `
                           + `${especie.nombre_comun}. Fuera de su tolerancia (±${especie.tol_ph}).`,
                    accion: desvio < 0
                        ? 'Encalar para subir el pH.'
                        : 'Acidificar con azufre elemental o materia orgánica.'
                });
            }

            if (suelo.textura && !especie.texturas.includes(suelo.textura)) {
                d.push({
                    severidad: 'aviso', tipo: 'suelo',
                    mensaje: `Suelo ${suelo.textura} (${suelo.arcilla_pct} % arcilla, `
                           + `${suelo.arena_pct} % arena). ${especie.nombre_comun} prefiere `
                           + `${especie.texturas.join(' o ')}.`,
                    accion: suelo.textura === 'arcilloso'
                        ? 'Drenaje lento: camas elevadas y riegos cortos.'
                        : 'Retiene poca agua: riegos frecuentes y materia orgánica.'
                });
            }

            if (suelo.carbono_organico_g_kg !== null && suelo.carbono_organico_g_kg < 10) {
                d.push({
                    severidad: 'aviso', tipo: 'nutricion',
                    mensaje: `Carbono orgánico bajo: ${suelo.carbono_organico_g_kg} g/kg. `
                           + `Un suelo agrícola sano anda sobre 20.`,
                    accion: 'Incorporar materia orgánica o planificar fertilización.'
                });
            }
        }

        // --- Evidencia biológica -------------------------------------------
        if (bio) {
            if (bio.registros_region === 0) {
                d.push({
                    severidad: 'aviso', tipo: 'evidencia',
                    mensaje: `GBIF no tiene ningún registro de ${bio.aceptado} en 550 km a la redonda, `
                           + `aunque sí ${bio.registros_mundo.toLocaleString('es')} en el mundo.`,
                    accion: 'Ausencia de registros no es ausencia de la especie: puede ser falta de muestreo.'
                });
            } else if (bio.registros_region > 0) {
                d.push({
                    severidad: 'info', tipo: 'evidencia',
                    mensaje: `${bio.registros_region.toLocaleString('es')} registros de `
                           + `${bio.aceptado} en 550 km a la redonda `
                           + `(${bio.registros_mundo.toLocaleString('es')} en el mundo).`,
                    accion: 'Hay constancia de que la especie se da en la región.'
                });
            }
        }

        // --- Veredicto ------------------------------------------------------
        if (evaluacion.total === null) {
            d.unshift({
                severidad: 'aviso', tipo: 'veredicto',
                mensaje: `Sin idoneidad calculable para ${especie.nombre_comun} en este punto.`,
                accion: evaluacion.motivo + ' Se muestra lo que sí llegó, pero no se '
                      + 'emite nota: un sitio sin datos no es un sitio bueno.'
            });
        } else {
            d.unshift({
                severidad: evaluacion.total >= 55 ? 'info'
                         : evaluacion.total >= 35 ? 'aviso' : 'critico',
                tipo: 'veredicto',
                mensaje: `Idoneidad ${evaluacion.total}/100 para ${especie.nombre_comun}: `
                       + `${evaluacion.nivel}.`,
                accion: this.explicarLimitante(evaluacion)
            });
        }

        return d;
    },

    /** Qué componente está tirando del índice hacia abajo. */
    explicarLimitante(ev) {
        const partes = [
            ['el clima', ev.climatica],
            ['el suelo', ev.edafica],
            ['la evidencia de GBIF', ev.evidencia]
        ].filter(p => p[1] !== null);

        if (!partes.length) return 'No hay ningún componente con datos.';

        const peor = partes.reduce((a, p) => p[1] < a[1] ? p : a, partes[0]);
        return `El factor que más limita es ${peor[0]} (${peor[1]}/100).`;
    },

    /** Ranking de todas las especies para un mismo sitio. */
    ranking(sitio, especies) {
        return especies
            .map(e => {
                // La evidencia de GBIF es por especie; en el ranking solo se
                // tiene la del que se consultó, así que se evalúa sin ella
                // para que la comparación sea justa entre las seis.
                const ev = this.evaluar({ clima: sitio.clima, suelo: sitio.suelo }, e);
                return { especie: e, ...ev };
            })
            .sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
    }
};
