// ==========================================================================
//  MODELOS MATEMÁTICOS DE CRECIMIENTO
//  Los cuatro devuelven la biomasa N en gramos para un día t.
// ==========================================================================

const Modelos = {

    /**
     * LINEAL — N(t) = a·t + b
     * El incremento es constante. No tiene techo biológico propio, así que
     * se define para que llegue exactamente a K el último día: a = (K−N0)/días.
     * Sirve de referencia: cualquier modelo realista debe superarlo al inicio
     * y quedarse por debajo al final.
     */
    lineal(t, p) {
        const a = (p.K - p.N0) / p.dias;
        return Math.max(0, a * t + p.N0);
    },

    /**
     * EXPONENCIAL — N(t) = N₀·e^(r·t)
     * Crecimiento sin límite: describe bien la fase juvenil, cuando no hay
     * competencia por luz ni nutrientes, pero se dispara al infinito. Lo
     * recortamos en K para que no rompa la escala de las gráficas.
     */
    exponencial(t, p) {
        return Math.min(p.K, p.N0 * Math.exp(p.r * t));
    },

    /**
     * LOGÍSTICO (Verhulst) — dN/dt = r·N·(1 − N/K)
     * Es el modelo por defecto. La ecuación diferencial dice que la planta
     * crece en proporción a lo que ya tiene, frenado por lo que le falta para
     * llenar la capacidad de carga. Como las condiciones ambientales se
     * mantienen fijas durante una corrida, r es constante y se puede usar la
     * solución analítica en vez de integrar paso a paso:
     *
     *     N(t) = K / (1 + ((K − N₀)/N₀)·e^(−r·t))
     *
     * Da una curva en S simétrica, con el punto de inflexión en K/2.
     */
    logistico(t, p) {
        const A = (p.K - p.N0) / p.N0;
        return p.K / (1 + A * Math.exp(-p.r * t));
    },

    /**
     * GOMPERTZ — N(t) = K·exp(−exp(−r·(t − t₀)))
     * También es una curva en S, pero asimétrica: acelera antes y frena más
     * despacio que la logística. Describe mejor cultivos de ciclo corto y
     * tejidos que maduran de forma desigual.
     *
     * t₀ es el punto de inflexión. No se pide al usuario: se deduce para que
     * la curva arranque exactamente en N₀, despejando de N(0) = N₀:
     *     t₀ = ln(ln(K/N₀)) / r
     */
    gompertz(t, p) {
        // Si N₀ ya alcanzó o superó K —cosa que puede pasar al intervenir a
        // mitad del ciclo y empeorar las condiciones, porque K baja— el
        // logaritmo se indefine. Se acota la razón apenas por encima de 1, con
        // lo que t₀ se va muy atrás y la curva sale ya en su meseta: Gompertz
        // no sabe describir un retroceso, así que se queda plana en K.
        const razon = Math.max(1.0001, p.K / p.N0);
        const t0 = Math.log(Math.log(razon)) / p.r;
        return p.K * Math.exp(-Math.exp(-p.r * (t - t0)));
    }
};

const MODELOS_INFO = {
    lineal: {
        etiqueta: 'Lineal',
        formula: 'N(t) = a·t + b',
        descripcion: 'Incremento constante. Referencia de comparación, sin realismo biológico.'
    },
    exponencial: {
        etiqueta: 'Exponencial',
        formula: 'N(t) = N₀·e^(r·t)',
        descripcion: 'Fase juvenil sin competencia. Se dispara si no se acota.'
    },
    logistico: {
        etiqueta: 'Logístico (Verhulst)',
        formula: 'dN/dt = r·N·(1 − N/K)',
        descripcion: 'Curva en S simétrica. El estándar para biomasa vegetal.'
    },
    gompertz: {
        etiqueta: 'Gompertz',
        formula: 'N(t) = K·exp(−exp(−r·(t − t₀)))',
        descripcion: 'Curva en S asimétrica. Acelera antes y frena más despacio.'
    }
};
