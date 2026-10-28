// ==========================================================================
//  GLOBO TERRÁQUEO 3D  ·  Three.js
//
//  Una esfera, los contornos de 177 países dibujados como líneas, y encima
//  marcadores georreferenciados. No se usa ninguna textura de imagen: toda la
//  geografía sale de datos/paises.json, que son los mismos polígonos con los
//  que el servidor averigua en qué país caíste.
// ==========================================================================

const Globo = {

    RADIO: 1,
    marcadores: {},        // { A: {...}, B: {...} }
    onClic: null,          // callback que app.js conecta

    // ----------------------------------------------------------------------
    //  Proyección esférica
    // ----------------------------------------------------------------------

    /**
     * Latitud y longitud a coordenadas 3D.
     *
     * phi mide desde el polo norte (por eso 90 − lat) y theta da la vuelta al
     * ecuador. El signo negativo en X es lo que hace que el meridiano cero
     * quede de frente y el este caiga a la derecha, como en un mapa.
     */
    aVector(lat, lon, altura = 0) {
        const phi = (90 - lat) * Math.PI / 180;
        const theta = (lon + 180) * Math.PI / 180;
        const r = this.RADIO + altura;

        return new THREE.Vector3(
            -r * Math.sin(phi) * Math.cos(theta),
             r * Math.cos(phi),
             r * Math.sin(phi) * Math.sin(theta)
        );
    },

    /** El camino inverso: de un punto de la esfera a latitud y longitud. */
    aCoordenada(v) {
        const p = v.clone().normalize();
        const lat = 90 - Math.acos(p.y) * 180 / Math.PI;
        let lon = Math.atan2(p.z, -p.x) * 180 / Math.PI - 180;
        if (lon < -180) lon += 360;

        return { lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
    },

    // ----------------------------------------------------------------------
    //  Montaje
    // ----------------------------------------------------------------------
    async iniciar(lienzo, rutaPaises) {
        this.escena = new THREE.Scene();
        this.escena.background = new THREE.Color(0x070b12);

        this.camara = new THREE.PerspectiveCamera(
            45, lienzo.clientWidth / lienzo.clientHeight, 0.01, 100);
        this.camara.position.set(0, 0.9, 2.9);

        this.renderizador = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
        this.renderizador.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.controles = new THREE.OrbitControls(this.camara, lienzo);
        this.controles.enableDamping = true;
        this.controles.dampingFactor = 0.08;
        this.controles.minDistance = 1.25;
        this.controles.maxDistance = 6;
        this.controles.enablePan = false;
        this.controles.autoRotate = true;
        this.controles.autoRotateSpeed = 0.35;

        this.escena.add(new THREE.AmbientLight(0xffffff, 0.75));
        const sol = new THREE.DirectionalLight(0xfff3e0, 0.9);
        sol.position.set(3, 2, 4);
        this.escena.add(sol);

        this.oceano();
        this.rejilla();
        await this.continentes(rutaPaises);

        // Capas que se vacían y se vuelven a llenar según lo que haya que ver
        this.capaMarcadores = new THREE.Group();
        this.capaOcurrencias = new THREE.Group();
        this.capaArcos = new THREE.Group();
        this.escena.add(this.capaMarcadores, this.capaOcurrencias, this.capaArcos);

        this.rayo = new THREE.Raycaster();
        this.puntero = new THREE.Vector2();
        this.lienzo = lienzo;
        this.conectarClic(lienzo);

        this.redimensionar();
        window.addEventListener('resize', () => this.redimensionar());

        this.reloj = new THREE.Clock();
        this.animar();
    },

    oceano() {
        this.esfera = new THREE.Mesh(
            new THREE.SphereGeometry(this.RADIO, 64, 48),
            new THREE.MeshPhongMaterial({
                color: 0x10263f, emissive: 0x05101c,
                specular: 0x2b5f8f, shininess: 18
            })
        );
        this.escena.add(this.esfera);

        // Halo de atmósfera: una esfera un poco mayor dibujada por dentro.
        // Es un truco barato que da sensación de volumen sin post-proceso.
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(this.RADIO * 1.018, 48, 32),
            new THREE.MeshBasicMaterial({
                color: 0x3d7fbf, transparent: true, opacity: 0.09,
                side: THREE.BackSide
            })
        );
        this.escena.add(halo);
    },

    /** Meridianos y paralelos cada 30°, muy tenues: dan referencia sin estorbar. */
    rejilla() {
        const puntos = [];
        const paso = 4;

        for (let lon = -180; lon < 180; lon += 30) {
            for (let lat = -90; lat < 90; lat += paso) {
                puntos.push(this.aVector(lat, lon, 0.001),
                            this.aVector(lat + paso, lon, 0.001));
            }
        }
        for (let lat = -60; lat <= 60; lat += 30) {
            for (let lon = -180; lon < 180; lon += paso) {
                puntos.push(this.aVector(lat, lon, 0.001),
                            this.aVector(lat, lon + paso, 0.001));
            }
        }

        const geo = new THREE.BufferGeometry().setFromPoints(puntos);
        this.escena.add(new THREE.LineSegments(geo,
            new THREE.LineBasicMaterial({ color: 0x2a4766, transparent: true, opacity: 0.4 })));
    },

    /**
     * Contornos de los países.
     *
     * Cada anillo del GeoJSON es una polilínea cerrada: se convierte cada par
     * de vértices consecutivos en un segmento y todo se junta en un único
     * LineSegments. Un solo objeto con 10.000 vértices se dibuja de una vez;
     * 177 objetos separados costarían 177 llamadas de dibujo por frame.
     */
    async continentes(ruta) {
        const paises = await (await fetch(ruta)).json();
        const puntos = [];

        paises.forEach(pais => {
            pais.poligonos.forEach(poligono => {
                poligono.forEach(anillo => {
                    for (let i = 0; i < anillo.length - 1; i++) {
                        puntos.push(this.aVector(anillo[i][1], anillo[i][0], 0.004),
                                    this.aVector(anillo[i + 1][1], anillo[i + 1][0], 0.004));
                    }
                });
            });
        });

        const geo = new THREE.BufferGeometry().setFromPoints(puntos);
        this.escena.add(new THREE.LineSegments(geo,
            new THREE.LineBasicMaterial({ color: 0x5fd08a })));

        this.nPaises = paises.length;
        this.nVertices = puntos.length;
    },

    // ----------------------------------------------------------------------
    //  Marcadores
    // ----------------------------------------------------------------------

    /**
     * Clava un alfiler en una coordenada.
     * El cono se orienta hacia el centro de la Tierra con lookAt, así que
     * queda perpendicular a la superficie en cualquier latitud.
     */
    marcar(id, lat, lon, color) {
        this.quitarMarcador(id);

        const grupo = new THREE.Group();
        const base = this.aVector(lat, lon);

        const aguja = new THREE.Mesh(
            new THREE.ConeGeometry(0.018, 0.09, 10),
            new THREE.MeshBasicMaterial({ color })
        );
        aguja.position.copy(this.aVector(lat, lon, 0.045));
        aguja.lookAt(0, 0, 0);
        aguja.rotateX(Math.PI / 2);
        grupo.add(aguja);

        const punto = new THREE.Mesh(
            new THREE.SphereGeometry(0.014, 12, 10),
            new THREE.MeshBasicMaterial({ color })
        );
        punto.position.copy(base);
        grupo.add(punto);

        // Anillo plano sobre la superficie, para que se vea desde lejos
        const halo = new THREE.Mesh(
            new THREE.RingGeometry(0.028, 0.042, 24),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55,
                                          side: THREE.DoubleSide })
        );
        halo.position.copy(this.aVector(lat, lon, 0.002));
        halo.lookAt(0, 0, 0);
        grupo.add(halo);

        grupo.userData = { id, lat, lon };
        this.capaMarcadores.add(grupo);
        this.marcadores[id] = { grupo, lat, lon };

        return this.marcadores[id];
    },

    quitarMarcador(id) {
        const m = this.marcadores[id];
        if (!m) return;
        this.capaMarcadores.remove(m.grupo);
        this.liberar(m.grupo);
        delete this.marcadores[id];
    },

    /**
     * Nube de ocurrencias de GBIF.
     *
     * Son cientos de puntos, así que van en un único THREE.Points con un
     * BufferGeometry: un objeto, una llamada de dibujo. Crear una esfera por
     * registro tumbaría el navegador con 300 y es inviable con los millones
     * que GBIF puede llegar a tener.
     */
    pintarOcurrencias(puntos, color = 0xffc85c) {
        this.limpiarOcurrencias();
        if (!puntos || !puntos.length) return 0;

        const posiciones = new Float32Array(puntos.length * 3);

        puntos.forEach((p, i) => {
            const v = this.aVector(p.lat, p.lon, 0.012);
            posiciones[i * 3]     = v.x;
            posiciones[i * 3 + 1] = v.y;
            posiciones[i * 3 + 2] = v.z;
        });

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));

        const nube = new THREE.Points(geo, new THREE.PointsMaterial({
            color, size: 0.016, sizeAttenuation: true,
            transparent: true, opacity: 0.9
        }));

        this.capaOcurrencias.add(nube);
        return puntos.length;
    },

    limpiarOcurrencias() {
        while (this.capaOcurrencias.children.length) {
            const o = this.capaOcurrencias.children[0];
            this.capaOcurrencias.remove(o);
            this.liberar(o);
        }
    },

    /**
     * Arco entre dos coordenadas, para la comparación A/B.
     *
     * El punto de control de la curva es el punto medio empujado hacia fuera
     * en proporción a la distancia entre los extremos: dos lugares cercanos
     * dan un arco bajo y dos antípodas uno que se eleva mucho. Si la curva
     * fuera una recta, atravesaría el planeta por dentro.
     */
    arco(a, b, color = 0x8ad6ff) {
        this.limpiarArcos();
        if (!a || !b) return;

        const p1 = this.aVector(a.lat, a.lon);
        const p2 = this.aVector(b.lat, b.lon);

        const separacion = p1.distanceTo(p2);
        const medio = p1.clone().add(p2).multiplyScalar(0.5)
                        .normalize().multiplyScalar(this.RADIO + separacion * 0.45);

        const curva = new THREE.QuadraticBezierCurve3(p1, medio, p2);
        const geo = new THREE.BufferGeometry().setFromPoints(curva.getPoints(64));

        this.capaArcos.add(new THREE.Line(geo,
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })));
    },

    limpiarArcos() {
        while (this.capaArcos.children.length) {
            const o = this.capaArcos.children[0];
            this.capaArcos.remove(o);
            this.liberar(o);
        }
    },

    // ----------------------------------------------------------------------
    //  Bucle y utilidades
    // ----------------------------------------------------------------------
    conectarClic(lienzo) {
        let xAbajo = 0, yAbajo = 0;

        lienzo.addEventListener('pointerdown', e => { xAbajo = e.clientX; yAbajo = e.clientY; });

        lienzo.addEventListener('pointerup', e => {
            // Si el puntero se movió, el usuario estaba girando el globo, no
            // señalando un punto.
            if (Math.abs(e.clientX - xAbajo) + Math.abs(e.clientY - yAbajo) > 6) return;

            const caja = lienzo.getBoundingClientRect();
            this.puntero.x = ((e.clientX - caja.left) / caja.width) * 2 - 1;
            this.puntero.y = -((e.clientY - caja.top) / caja.height) * 2 + 1;

            this.rayo.setFromCamera(this.puntero, this.camara);
            const tocados = this.rayo.intersectObject(this.esfera, false);
            if (!tocados.length) return;

            this.controles.autoRotate = false;
            const coord = this.aCoordenada(tocados[0].point);
            if (this.onClic) this.onClic(coord);
        });
    },

    /** Gira el globo hasta poner una coordenada de frente. */
    irA(lat, lon, distancia = 2.4) {
        this.controles.autoRotate = false;
        const destino = this.aVector(lat, lon).normalize().multiplyScalar(distancia);
        this.camara.position.copy(destino);
        this.controles.update();
    },

    liberar(objeto) {
        objeto.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
    },

    redimensionar() {
        const l = this.lienzo;
        if (!l || !l.clientWidth || !l.clientHeight) return;
        this.camara.aspect = l.clientWidth / l.clientHeight;
        this.camara.updateProjectionMatrix();
        this.renderizador.setSize(l.clientWidth, l.clientHeight, false);
    },

    animar() {
        requestAnimationFrame(() => this.animar());
        this.controles.update();
        this.renderizador.render(this.escena, this.camara);
    }
};
