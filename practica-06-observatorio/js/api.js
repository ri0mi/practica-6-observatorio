// ==========================================================================
//  CLIENTE DEL PROXY
//  El navegador NUNCA llama a GBIF, NASA, Open-Meteo o SoilGrids. Solo habla
//  con api/proxy.php. Ese es el contrato de toda la práctica.
// ==========================================================================

const Api = {

    base: 'api/proxy.php',

    async pedir(parametros) {
        const url = `${this.base}?${new URLSearchParams(parametros)}`;

        let respuesta;
        try {
            respuesta = await fetch(url);
        } catch (e) {
            throw new Error('No se pudo contactar el proxy. ¿Está corriendo el servidor?');
        }

        const texto = await respuesta.text();
        let cuerpo;
        try {
            cuerpo = JSON.parse(texto);
        } catch (e) {
            // Si PHP imprimió un warning antes del JSON, verlo crudo ahorra
            // media hora de adivinanzas.
            throw new Error(`Respuesta no JSON (${respuesta.status}): ${texto.slice(0, 180)}`);
        }

        if (!respuesta.ok || cuerpo.ok === false) {
            throw new Error(cuerpo.error || `Error HTTP ${respuesta.status}`);
        }

        return cuerpo.datos;
    },

    /** Las cuatro fuentes de un punto, en una sola petición. */
    sitio(lat, lon, especieCientifica) {
        const p = { fuente: 'sitio', lat, lon };
        if (especieCientifica) p.especie = especieCientifica;
        return this.pedir(p);
    },

    lugar(lat, lon)  { return this.pedir({ fuente: 'lugar', lat, lon }); },
    clima(lat, lon)  { return this.pedir({ fuente: 'clima', lat, lon }); },
    nasa(lat, lon)   { return this.pedir({ fuente: 'nasa', lat, lon }); },
    suelo(lat, lon)  { return this.pedir({ fuente: 'suelo', lat, lon }); },

    biodiversidad(especie, lat, lon) {
        return this.pedir({ fuente: 'biodiversidad', especie, lat, lon });
    },

    buscar(q) { return this.pedir({ fuente: 'buscar', q }); }
};
