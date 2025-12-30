// =================================================================================
// GESTIÓNPRO - SCRIPT CENTRAL UNIFICADO (APP.JS)
// Versión 77.0: Filtros de fecha dinámicos, nuevo módulo de reciclaje e informe para directora.
// =================================================================================
// CAMBIOS CLAVE EN ESTA VERSIÓN:
// 1. [FEATURE] FILTROS DINÁMICOS: Los selectores de año y mes en el Dashboard ahora se
//    pueblan automáticamente basándose en los años y meses presentes en los datos de
//    residuos y facturas, en lugar de usar una lista estática.
// 2. [FEATURE] MÓDULO DE RECICLAJE: Se añade una nueva sección para el registro
//    mensual de materiales reciclados como papel y cartón, con su propia tabla y
//    módulo de gestión.
// 3. [FEATURE] INFORME PARA DIRECTORA: Se implementa una nueva función para generar
//    un informe en formato Word que replica exactamente la estructura del documento
//    proporcionado, con datos y costos dinámicos.
// =================================================================================


// ---------------------------------------------------------------------------------
// PARTE 1: CONFIGURACIÓN DEL CLIENTE LOCAL (DB)
// ---------------------------------------------------------------------------------

/**
 * @class DBQuery
 * Proporciona una interfaz fluida (fluent interface) para construir y ejecutar consultas
 * a la API del backend. Emula la sintaxis de constructores de consultas populares
 * para facilitar su uso.
 */
class DBQuery {
    constructor(table) {
        this.table = table;
        this.filters = {};
        this.dateStart = null;
        this.dateEnd = null;
        this.orderField = null;
        this.orderAsc = false;
        this.rangeStart = null;
        this.rangeEnd = null;
        this.searchTerm = null;
        this.singleFlag = false;
        this.isNullField = null;
    }

    order(field, opts = {}) { this.orderField = field; this.orderAsc = !!opts.ascending; return this; }
    eq(key, value) { this.filters[key] = [value]; return this; }
    in(key, values) { this.filters[key] = Array.isArray(values) ? values : [values]; return this; }
    
    // MODIFICADO: Se añadieron 'pickup_date', 'delivery_date', 'arrival_date'
    gte(key, value) {
        const dateKeys = ['date', 'created_at', 'billing_cycle_start', 'billing_cycle_end', 'service_date', 'pickup_date', 'delivery_date', 'arrival_date'];
        if (dateKeys.includes(key)) { this.dateStart = value; } else { this.filters[key] = this.filters[key] || []; this.filters[key][0] = value; }
        return this;
    }
    
    // MODIFICADO: Se añadieron 'pickup_date', 'delivery_date', 'arrival_date'
    lte(key, value) {
        const dateKeys = ['date', 'created_at', 'billing_cycle_start', 'billing_cycle_end', 'service_date', 'pickup_date', 'delivery_date', 'arrival_date'];
        if (dateKeys.includes(key)) { this.dateEnd = value; } else { this.filters[key] = this.filters[key] || []; this.filters[key][1] = value; }
        return this;
    }
    
    ilike(key, pattern) { this.searchTerm = (pattern || '').replace(/^%+|%+$/g, ''); return this; }
    is(key, value) { if (value === null || value === undefined) { this.isNullField = key; return this; } return this.eq(key, value); }
    or(conditionString) {
        const parts = (conditionString || '').split(',');
        if (parts.length > 0) { const fragment = parts[0]; const match = fragment.split('.ilike.')[1]; if (match) { this.searchTerm = match.replace(/^%+|%+$/g, ''); } }
        return this;
    }
    range(from, to) { this.rangeStart = from; this.rangeEnd = to; return this; }
    single() { this.singleFlag = true; return this; }

    select(columns = '*', options = {}) {
        this._selectColumns = columns;
        this._selectOptions = options;
        return this;
    }

    /**
     * Inserta uno o varios registros en la tabla actual usando la API REST de Supabase.
     * Esta implementación reemplaza la llamada al backend PHP y utiliza la base de datos
     * seleccionada en currentClientKey. Envía los datos como JSON y solicita la
     * representación de los registros insertados.
     * @param {Object|Array} data - Registro o array de registros a insertar.
     * @returns {Promise<{data:any, error:any}>}
     */
    insert(data) {
        // Validar que exista una sesión activa
        if (!currentClientKey) {
            return Promise.resolve({ data: null, error: { message: 'No hay sesión activa' } });
        }
        return supabaseRequest(currentClientKey, `/rest/v1/${this.table}`, 'POST', data, null, { Prefer: 'return=representation' })
            .then(resp => ({ data: resp, error: null }))
            .catch(err => ({ data: null, error: { message: err.message || 'Error en creación de registro' } }));
    }

    /**
     * Actualiza un registro existente en la tabla utilizando la API REST de Supabase.
     * Requiere que la consulta tenga un filtro por ID aplicado mediante .eq('id', valor).
     * @param {Object} data - Campos que se actualizarán.
     */
    update(data) {
        if (!currentClientKey) {
            return Promise.resolve({ data: null, error: { message: 'No hay sesión activa' } });
        }
        const id = this.filters.id ? this.filters.id[0] : null;
        if (!id) {
            return Promise.resolve({ data: null, error: { message: 'No se especificó un ID para la actualización. Use .eq("id", valor) antes de .update().' } });
        }
        const params = `?id=eq.${encodeURIComponent(id)}`;
        return supabaseRequest(currentClientKey, `/rest/v1/${this.table}${params}`, 'PATCH', data, null, { Prefer: 'return=representation' })
            .then(resp => ({ data: resp, error: null }))
            .catch(err => ({ data: null, error: { message: err.message || 'Error actualizando registro' } }));
    }

    /**
     * Elimina uno o varios registros de la tabla mediante la API REST de Supabase.
     * Los IDs deben especificarse con .eq('id', valor) o .in('id', valores).
     */
    delete() {
        if (!currentClientKey) {
            return Promise.resolve({ data: null, error: { message: 'No hay sesión activa' } });
        }
        const idsToDelete = this.filters.id || [];
        if (idsToDelete.length === 0) {
            return Promise.resolve({ data: null, error: { message: 'No se especificó un ID para eliminar. Use .eq("id", valor) o .in("id", valores) antes de .delete().' } });
        }
        const paramStr = idsToDelete.map(id => encodeURIComponent(id)).join(',');
        const params = `?id=in.(${paramStr})`;
        return supabaseRequest(currentClientKey, `/rest/v1/${this.table}${params}`, 'DELETE', null)
            .then(() => ({ data: {}, error: null }))
            .catch(err => ({ data: null, error: { message: err.message || 'Error eliminando registro' } }));
    }

    async _fetchData() {
        // Esta función construye una consulta a la API REST de Supabase basada en los filtros definidos.
        if (!currentClientKey) {
            return { data: null, error: { message: 'No hay sesión activa' }, count: 0 };
        }
        try {
            const paramsList = [];
            // Selección de columnas
            const selectClause = this._selectColumns || '*';
            paramsList.push(`select=${encodeURIComponent(selectClause)}`);
            // Filtros básicos (eq, in)
            for (const [key, vals] of Object.entries(this.filters)) {
                if (Array.isArray(vals) && vals.length === 1) {
                    paramsList.push(`${key}=eq.${encodeURIComponent(vals[0])}`);
                } else if (Array.isArray(vals) && vals.length > 1) {
                    paramsList.push(`${key}=in.(${vals.map(v => encodeURIComponent(v)).join(',')})`);
                }
            }
            // Filtros por fecha (gte y lte)
            if (this.dateStart || this.dateEnd) {
                let dateField;
                if (this.table === 'monthly_invoices') dateField = 'billing_cycle_end';
                else if (this.table === 'unit_pickups') dateField = 'pickup_date';
                else if (this.table === 'supply_deliveries') dateField = 'delivery_date';
                else if (this.table === 'supply_arrivals') dateField = 'arrival_date';
                else dateField = 'date';
                if (this.dateStart) paramsList.push(`${dateField}=gte.${encodeURIComponent(this.dateStart)}`);
                if (this.dateEnd) paramsList.push(`${dateField}=lte.${encodeURIComponent(this.dateEnd)}`);
            }
            // Filtro por nulos
            if (this.isNullField) {
                paramsList.push(`${this.isNullField}=is.null`);
            }
            // Ordenamiento
            if (this.orderField) {
                paramsList.push(`order=${this.orderField}.${this.orderAsc ? 'asc' : 'desc'}`);
            }
            // Rango (paginación)
            if (this.rangeStart !== null && this.rangeEnd !== null) {
                const limit = this.rangeEnd - this.rangeStart + 1;
                paramsList.push(`limit=${limit}`);
                paramsList.push(`offset=${this.rangeStart}`);
            }
            // Búsqueda genérica (ilike)
            if (this.searchTerm) {
                // Aplica el filtro a un campo común 'name' si existe; se puede ajustar según tablas.
                paramsList.push(`name=ilike.*${encodeURIComponent(this.searchTerm)}*`);
            }
            const queryString = paramsList.join('&');
            const endpoint = `/rest/v1/${this.table}?${queryString}`;
            const response = await supabaseRequest(currentClientKey, endpoint, 'GET');
            const arrayData = Array.isArray(response) ? response : (response ? [response] : []);
            const count = arrayData.length;
            if (this.singleFlag) {
                return { data: arrayData[0] || null, error: null, count };
            }
            return { data: response, error: null, count };
        } catch (err) {
            return { data: null, error: { message: err.message || 'Error al consultar datos' }, count: 0 };
        }
    }
    
    then(onFulfilled, onRejected) { return this._fetchData().then(onFulfilled, onRejected); }
}

// ==============================================================================
// PARTE INTERMEDIA: CONFIGURACIÓN DE SUPABASE PERSONALIZADA
// ==============================================================================
// Definición de las bases de datos disponibles y sus claves de acceso. Las
// constantes SUPABASE_URL_SST y SUPABASE_ANON_KEY_SST deben definirse en
// config.js antes de cargar este script. De igual manera para HPL.
const supabaseClients = {
    // La base de datos del Servicio (SST) utiliza las variables definidas en config.js
    sst: { url: window.SUPABASE_SERVICE_URL, anonKey: window.SUPABASE_SERVICE_ANON_KEY, name: 'SST' },
    // La base del hospital (HPL) utiliza las variables definidas en config.js
    hpl: { url: window.SUPABASE_HOSPITAL_URL, anonKey: window.SUPABASE_HOSPITAL_ANON_KEY, name: 'HPL' }
};

// Variables de estado globales para la sesión actual. Se almacenan en memoria
// para evitar el uso de localStorage y así evitar el bloqueo por tracking.
// Variables de estado globales para la sesión actual. Se almacenan en memoria
// para evitar el uso de localStorage y así evitar el bloqueo por tracking.
// También utilizamos sessionStorage para persistir la sesión a lo largo de
// diferentes páginas durante la sesión del navegador. Al recargar o abrir
// otra página, se recuperan estos valores si existen.
let currentClientKey = null;
let authToken = null;

// Recuperar sesión persistida desde sessionStorage si existe. Esto permite
// mantener la sesión después de un redirect sin depender de almacenamiento
// permanente. Se ejecuta en el momento de cargar el script.
try {
    const storedToken = sessionStorage.getItem('authToken');
    const storedClient = sessionStorage.getItem('currentClientKey');
    if (storedToken && storedClient) {
        authToken = storedToken;
        currentClientKey = storedClient;
    }
} catch (e) {
    // Si sessionStorage no está disponible, simplemente ignorar
}

/**
 * Realiza una solicitud HTTP al API de Supabase correspondiente. Construye la
 * URL completa a partir del proyecto y endpoint, configura los encabezados
 * necesarios (apikey y Authorization) y maneja los posibles errores.
 * @param {string} clientKey - Clave del proyecto ('sst' o 'hpl').
 * @param {string} endpoint - Ruta del endpoint, comenzando por '/'.
 * @param {string} method - Método HTTP (GET, POST, PATCH, DELETE, HEAD).
 * @param {Object|null} body - Datos a enviar como JSON.
 * @param {string|null} paramString - Parámetros adicionales en la URL.
 * @param {Object} extraHeaders - Encabezados adicionales.
 */
async function supabaseRequest(clientKey, endpoint, method = 'GET', body = null, paramString = null, extraHeaders = {}) {
    const client = supabaseClients[clientKey];
    if (!client) {
        throw new Error('Cliente Supabase no válido');
    }
    let url = client.url + endpoint;
    // Agregar query params si vienen como argumento extra
    if (paramString) {
        url += (url.includes('?') ? '&' : '?') + paramString;
    }
    const headers = {
        apikey: client.anonKey,
        ...extraHeaders
    };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    const options = { method, headers };
    if (body !== null && method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (!response.ok) {
        let message = response.statusText;
        try {
            const errorData = await response.json();
            // Supabase puede devolver diferentes campos de error:
            // error_description en el endpoint de auth, error.description en otras rutas,
            // error en rutas REST, o message en respuesta genérica
            message = errorData.error_description || errorData.error?.description || errorData.error || errorData.message || message;
        } catch (e) {
            // ignorar si no es JSON
        }
        throw new Error(message);
    }
    if (method === 'HEAD') return null;
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

async function apiFetch(url, options = {}) {
    try {
        const finalOptions = { ...options, credentials: 'include' };
        const res = await fetch(url, finalOptions);
        const responseText = await res.text();

        // Manejar respuestas vacías
        if (!responseText && res.ok) {
            return { success: true };
        }

        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error("Error: La respuesta del servidor no es un JSON válido.", responseText);
            throw new Error('El servidor devolvió una respuesta inesperada.');
        }

        // --- MEJORA: DETECCIÓN DE SESIÓN EXPIRADA (401) ---
        if (res.status === 401) {
            console.warn("Sesión expirada. Redirigiendo al login...");
            // Evitar bucle infinito si ya estamos en el login
            if (!window.location.pathname.includes('login.html')) {
                window.location.href = 'login.html';
            }
            throw new Error('Sesión expirada. Por favor, inicie sesión nuevamente.');
        }
        // --------------------------------------------------

        if (!res.ok || (result.success !== undefined && !result.success)) {
            throw new Error(result.message || 'Ocurrió un error en el servidor.');
        }

        return result;

    } catch (err) {
        throw new Error(err.message || 'No se pudo conectar con el servidor.');
    }
}

/**
 * Registra un nuevo usuario en Supabase. Primero intenta crear la cuenta en la
 * base de datos SST utilizando el endpoint de autenticación de Supabase. Tras
 * registrarse, inserta una fila en la tabla "users" con rol auxiliar. Si la
 * cuenta ya existe, se devuelve el error correspondiente.
 * @param {Object} params - Contiene email, password y opcionalmente name.
 */
async function signUp({ email, password, name }) {
    try {
        // Utilizamos solo la base SST para el registro de nuevos usuarios
        const clientKey = 'sst';
        const body = { email, password, data: { name } };
        const result = await supabaseRequest(clientKey, '/auth/v1/signup', 'POST', body);
        // El endpoint devuelve { user, session, error }
        if (result && result.session && result.session.access_token) {
            authToken = result.session.access_token;
            currentClientKey = clientKey;
        }
        // Insertar perfil en la tabla 'perfiles' con el id del usuario de auth
        try {
            const userId = result && result.user ? result.user.id : null;
            if (userId) {
                // Verificar si ya existe un perfil con este id o email para evitar duplicados
                const existing = await supabaseRequest(clientKey, '/rest/v1/perfiles', 'GET', null,
                    `select=id&or=(id.eq.${encodeURIComponent(userId)},email.eq.${encodeURIComponent(email)})&limit=1`,
                    { Authorization: `Bearer ${authToken}` }
                ).catch(() => []);
                const exists = Array.isArray(existing) && existing.length > 0;
                if (!exists) {
                    await supabaseRequest(clientKey, '/rest/v1/perfiles', 'POST', {
                        id: userId,
                        email,
                        nombre_completo: name,
                        rol: 'auxiliar',
                        establecimiento_id: null
                    }, null, { Authorization: `Bearer ${authToken}`, Prefer: 'return=minimal' });
                }
            }
        } catch (e) {
            console.warn('No se pudo insertar en perfiles:', e.message);
        }
        return { error: null };
    } catch (err) {
        return { error: { message: err.message } };
    }
}

// ... (código de signUp y signInWithPassword anterior) ...

/**
 * Inicia sesión con email y contraseña. Se intenta autenticar en ambas bases
 * (SST y HPL) de manera secuencial. La primera que devuelve un token válido
 * se selecciona como base activa. Luego recupera el rol del usuario desde la
 * tabla "users" para decidir la redirección.
 */
async function signInWithPassword({ email, password }) {
    let lastErr = null;
    // Intentar autenticación en ambas bases de datos (hpl y sst) secuencialmente
    // Probamos primero en HPL para permitir a los usuarios con el mismo correo
    // pero rol distinto seleccionar su base correctamente.
    for (const key of ['hpl', 'sst']) {
        try {
            // Realizar la solicitud de autenticación con grant_type=password
            const response = await supabaseRequest(key, '/auth/v1/token?grant_type=password', 'POST', { email, password });
            if (response && response.access_token) {
                // Con el token temporal, intentar obtener el rol del usuario desde la tabla "perfiles"
                let role = 'auxiliar';
                try {
                    const params = `select=rol&email=eq.${encodeURIComponent(email)}&limit=1`;
                    // Usar cabecera Authorization con el token devuelto para evitar depender del authToken global
                    const perfilData = await supabaseRequest(
                        key,
                        '/rest/v1/perfiles',
                        'GET',
                        null,
                        params,
                        { Authorization: `Bearer ${response.access_token}` }
                    );
                    if (Array.isArray(perfilData) && perfilData.length > 0 && perfilData[0].rol) {
                        role = perfilData[0].rol;
                    }
                } catch (e) {
                    // Si no se puede obtener el rol o no existe, se asume auxiliar
                }
                // Establecer el token y cliente actuales una vez que sabemos el rol
                authToken = response.access_token;
                currentClientKey = key;
                // Persistir la sesión en sessionStorage para que sobreviva al redirect
                try {
                    sessionStorage.setItem('authToken', authToken);
                    sessionStorage.setItem('currentClientKey', currentClientKey);
                    // Guardar el email actual para su uso posterior en getSession/Perfil
                    if (email) {
                        sessionStorage.setItem('userEmail', email);
                    }
                } catch (e) {
                    // Ignorar si sessionStorage no está disponible
                }
                // Redirigir de acuerdo al rol
                if (role === 'auxiliar') {
                    window.location.href = 'registro.html';
                } else {
                    window.location.href = 'index.html';
                }
                return { error: null };
            }
        } catch (err) {
            // Guardar el último error para informar si todas las bases fallan
            lastErr = err;
        }
    }
    return { error: { message: lastErr ? lastErr.message : 'Credenciales inválidas' } };
}

// --- ESTA ES LA FUNCIÓN QUE FALTABA ---
/**
 * Cierra la sesión activa en Supabase. Envía un logout al proyecto actual y
 * elimina el token almacenado en memoria.
 */
async function signOut() {
    if (!currentClientKey || !authToken) {
        return { error: null };
    }
    try {
        await supabaseRequest(currentClientKey, '/auth/v1/logout', 'POST', {});
    } catch (err) {
        // Ignorar errores de logout del backend
    }
    // Limpiar variables en memoria
    authToken = null;
    currentClientKey = null;
    // Eliminar datos persistidos en sessionStorage
    try {
        sessionStorage.removeItem('authToken');
        sessionStorage.removeItem('currentClientKey');
        sessionStorage.removeItem('userEmail');
        sessionStorage.removeItem('userName');
    } catch (e) {
        // SessionStorage puede no estar disponible
    }
    return { error: null };
}
// --------------------------------------

/**
 * Devuelve la sesión actual si existe. La sesión se mantiene en memoria
 * mediante la variable authToken. No se utiliza almacenamiento local para
 * evitar bloqueos de tracking.
 */
async function getSession() {
    try {
        // Si no hay token en memoria, intentar restaurarlo de sessionStorage
        if (!authToken) {
            try {
                const storedToken = sessionStorage.getItem('authToken');
                const storedClient = sessionStorage.getItem('currentClientKey');
                if (storedToken && storedClient) {
                    authToken = storedToken;
                    currentClientKey = storedClient;
                }
            } catch (e) {
                // Ignorar cualquier error al acceder a sessionStorage
            }
        }
        let session = null;
        if (authToken) {
            // Construir objeto de sesión con token
            session = { access_token: authToken };
            // Intentar recuperar email/nombre guardados
            try {
                const storedEmail = sessionStorage.getItem('userEmail');
                const storedName = sessionStorage.getItem('userName');
                if (storedEmail || storedName) {
                    session.user = { email: storedEmail || null, name: storedName || null };
                }
            } catch (e) {
                // Ignorar errores de sessionStorage
            }
            // Si no tenemos info de usuario o email, intentar obtenerlo desde Supabase Auth
            if ((!session.user || !session.user.email) && currentClientKey) {
                try {
                    const userInfo = await supabaseRequest(currentClientKey, '/auth/v1/user', 'GET', null, null, { Authorization: `Bearer ${authToken}` });
                    if (userInfo && userInfo.email) {
                        session.user = { email: userInfo.email, name: userInfo.user_metadata?.name || '' };
                        // Guardar en sessionStorage para futuras recuperaciones
                        try {
                            sessionStorage.setItem('userEmail', userInfo.email);
                            if (userInfo.user_metadata?.name) {
                                sessionStorage.setItem('userName', userInfo.user_metadata.name);
                            }
                        } catch (e2) {
                            // Ignore
                        }
                    }
                } catch (e) {
                    // no user info
                }
            }
        }
        return { data: { session }, error: null };
    } catch (err) {
        return { data: { session: null }, error: { message: err.message } };
    }
}

// Al definir el objeto db, signOut ya debe existir arriba
// Redirigir la tabla 'users' a 'perfiles' internamente para que las consultas CRUD
// apunten a la estructura correcta. Esto evita 404 en bases donde no existe 'users'.
const db = {
    from(table) {
        const actualTable = table === 'users' ? 'perfiles' : table;
        return new DBQuery(actualTable);
    },
    auth: { signUp, signInWithPassword, signOut, getSession }
};
window.db = db;

function formatCLP(num) { const n = parseFloat(num); const value = isNaN(n) ? 0 : n; return `$${Math.round(value).toLocaleString('es-CL')}`; }
window.formatCLP = formatCLP;

const Auth = {
    async signUp(credentials) {
        const { error } = await db.auth.signUp(credentials);
        return error;
    },
    async signIn(credentials) {
        // Delegar la redirección a signInWithPassword: esta función maneja la
        // lógica de redirección según el rol del usuario. Simplemente
        // devolvemos el posible error.
        const { error } = await db.auth.signInWithPassword(credentials);
        return error;
    },
    async signOut() {
        await db.auth.signOut();
        window.location.href = 'login.html';
    },
    async getSession() {
        const { data: { session } } = await db.auth.getSession();
        return session;
    },
    async checkAuth() {
        const session = await this.getSession();
        if (!session && !window.location.pathname.endsWith('/login.html')) {
            window.location.href = 'login.html';
        }
        return session;
    }
};
window.Auth = Auth;



// =================================================================================
// PARTE 2: CONFIGURACIÓN GLOBAL Y DATOS EN CACHÉ (MODIFICADO)
// =================================================================================
window.APP_CONFIG = {
    RECORDS_PER_PAGE: 25,
    wasteTypesInfo: {
        'Asimilables': { name: 'Asimilables', color: 'bg-green-500', icon: 'fa-recycle' },
        'Especiales': { name: 'Especiales', color: 'bg-yellow-500', icon: 'fa-biohazard' },
        'Peligrosos': { name: 'Peligrosos', color: 'bg-red-500', icon: 'fa-skull-crossbones' },
    },
    HOSPITAL_UNITS_FOR_REPORT: [
        'ABASTECIMIENTO', 'ALIMENTACION', 'CASINO 4 PISO', 'CLUB ESCOLAR', 'ENDOSCOPIA',
        'ESPECIALIDADES', 'ESTERILIZACION', 'FARMACIA', 'HOSPITAL DE DIA', 'IMAGENOLOGIA',
        'KINESIOLOGIA', 'LABORATORIO', 'M.QUIRURGICO', 'PABELLON', 'PALIATIVO',
        'PATIO', 'PISO-1', 'PISO-1A', 'PISO-1C', 'PISO-2', 'PISO-4', 'PISO-5',
        'REAS', 'SALA CUNA', 'SEDILES', 'UHCIP', 'URGENCIA', 'UTI', 'VESTIDORES', 'ZOCALO'
    ],
    // Como solicitaste, se omite el logo.
    HOSPITAL_LOGO_BASE64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAoAAAOoCAYAAABY1xZHAAAgAElEQVR4nOzdd5ydV33g/8956u1z7/QiaaQZNataxb3JNsYFjAMYQhYSU0NIyI8NCWGzJcuyhIQEEpZkIeFHFpYkm4QQlm4biLEx7ja2bKvYsmT1Nr3c+pSzfzx37oysdkczo2J/36/XlUYz5znn3KuR7pzv8z3fo/jwPRohhBDifKAs0D7/+cjPuWvwWboqo2ilKCkLA3m7EkIIIYQ4G4xzPQEhhBBCCCGEEEKcPyRQIIQQQgghhBBCiBoJFAghhBBCCCGEEKJGAgVCCCGEEEIIIYSokUCBEEIIIYQQQgghaiRQIIQQQgghhBBCiBoJFAghhBBCCCGEEKJGAgVCCCGEEEIIIYSokUCBEEIIIYQQQgghaiRQIIQQQgghhBBCiBoJFAghhBBCCCGEEKJGAgVCCCGEEEIIIYSokUCBEEIIIYQQQgghaiRQIIQQQgghhBBCiBoJFAghhBBCCCGEEKJGAgVCCCGEEEIIIYSokUCBEEIIIYQQQgghaiRQIIQQQgghhBBCiBoJFAghhBBCCCGEEKJGAgVCCCGEEEIIIYSokUCBEEIIIYQQQgghaiRQIIQQQgghhBBCiBoJFAghhBBCCCGEEKJGAgVCCCGEEEIIIYSokUCBEEIIIYQQQgghaiRQIIQQQgghhBBCiBoJFAghhBBCCCGEEKJGAgVCCCGEEEIIIYSokUCBEEIIIYQQQgghaiRQIIQQQgghhBBCiBoJFAghhBBCCCGEEKJGAgVCCCGEEEIIIYSokUCBEEIIIYQQQgghaiRQIIQQQgghhBBCiBrrXE9AiAuBUqCij6q/T9K13zVaI4QQQgghhBAXNAkUCHECUWBAoZkIAGh0COgQ9CtCBWrqQ6HUZDBBggdCnJ+y9/+47rbDm2561c5BvLbJ9+DZI6+1EOJCI1sPhHgFRfQPw1DVgEEULUCFGhWCoUPU1EcYokIdtZm4Xk18/Mr8AyGEEEIAGL09JP7sj8/1NIQQQpyAZBQIUWUY0aJeByFBOQQvjDIILAMck3jcImmb2KYirGYJKAVBqCl6AWOlAF300L4mVIBpgG1g2CYooqwEyS4QQgjxGqdaW4i9/z3Yr7sRwzAonOsJCSGEOI4ECsSrkqrdyJ/cBDD1N6p3/Keu20M/hFCD1sRck6YGl8aUTS7tkks7NKccMq6JaxlUEwgwFPiBZrzi0z/uMTxeYShfYXjcY6DgMVIJCSsBGAplKpRCggVCCCFem5JJYr/673DefAeG657r2QghhDgFCRSIV52JGgFKTQkYaIXWk+UFJrYVhFPu8utqoMCK2ayYl+byRVku7c6wrC1FV0OMTNwkbhtYhpoabyAINWUvZKwc0J/3eHmgyC/2jfDonhGe2TdK/0CRoBKiYhZaTQQLJFoghBDitUFbFu5bfonYu34FI5M519MRQghRBwkUiFeFKCgQRQFCP0QHIQQ6ekzdJ1CNIIRBGH3OjbYFEEImabOhu4HbV7eysjPN/MYYTQmbhriFa528nIdhKmzTIBWzaEo5dOVirOhI8vqLmtnZX+DnLw7ysx2DbD8wBka0HUEZklkghBDi1U0Dzk03EnvfezDb2871dIQQQkyDBArEBU8pINSEurofAI1lGsQdRcwwcE0Dy1IYloFhRpkFBBrfDxn2fAqVkJhrsGl5E29d385b1rSRck0gyhY47jhEPXVrw7EcU9EYt2iMWyxuTnDloiy9LQka0w7fNw1e6itQqgRRsEC2IQghhHiVMjesI/4bH8BasuRcT0UIIcQZkECBuGApQBnRNoPAD6ASAgonbdOZi7GsJUFPU4KurEs2YZNyTWzTINAaA8VgvsL/3XyEPQNFuhvj/N6NC7lmcSMhcHiswlChgtaQci1yCYu0G/1zUerY2gYTpx2goBKEFL3okXBMMq7JlQuzLGqMc2l3lj+5dxePvzSIDnVUt0CCBUIIIV6F0p/703M9BSGEEDMggQJxQZrYRRCWfAg0bsJicWeGtV1plnWmWNAUpy3l0Ji0ycQsYraBYxqYhkJrTcw2ODpW4cm9o7RnXG5f3YplGty7rZ9f7B8jCDUp1yQXt0k4JnHHIBOz6GpwmZ+NYVvGZDHEKdkFlqGwDEXJCxjIV3AMgyWtCToyLlcvznFnXxtaa57YNRQVVHRNCRQIIYQQQgghzisSKBAXnIm78DrUWIZBY9JiRXeG65Y28bplTazpTJGJ1fGtraE55RB3DJa1J3lk1zCP7h7h0GiZzgaXnqYEMcvEDzUjRc3AeAW0Jhe3aTAUZvU4xam7EAyliFkGMcvg4EiZobyHoaC7MU5L0ubNF7dRqgRsOzDGeNlHh3PzGgkhhBCnM7zppnM9BSGEEOcpCRSIC4qaiBL4IZQDli/K8tb17dyxto3eljiOYeBMKTyomUjt17XaAoZSDBU8thzK05iw2T1Y5PM/3cvh0TK9zXE+cVsv3Y1xkraJUgpTga81o0Wfsh8yXPSIOybx6raHqSaOTGzPuIyWAg6NlHngpUGWt6W4sifL4uYE1y1t4u7t/WzeO0qh5GPETDRKTkIQQgghhBBCnBckUCAuGFEBQY0uBzgxiyuXNvGG1S3csrKFVR2pY9pGsQF9TC0BPfGLgnwl5PBYmd2DRfYMFkm4JpcvbODq3iwb52eI2eZx46ddk3wlwAs05skPQaidvtCVdRkr+/zLL0YoeCFrutKkXJOe5jjXLW3k6HCJnWMViFlSq0AIIYQQQghx3pBAgbgg1BbSoQZTsawtyW9u6uaGpY00JW0gOqEAogKHRvWiY+/4T67Ey37I0fEKzx4cAwXXLslx12VdzM/G0FRPUJg6PtERiNn4KSIEHLsNIemYLG9LMl722XE0z87+Ais7UuQSNtcvaeTxl4bYeWA8ek7GSY5REEIIIYQQQoiz7NSrHiHOE0op8DUUfa7szfHr18zn2sU5mpI2oY62FRhKYUwECU7WT3Up3zdW4YVDeUaKPqs6Urz38nnMz8aiRtVTDAylao+THYd4MkE10KCAlpRDoRLw8K4hjoyWSTomKzpSzG9JQMJCh5owCKc9hhBCCCGEEELMBckoEOc9pSD0QwwFuWyM1y9v4o2rWmhLO0AtyaCOhfbkgn+o4HFotExPU5xLFzTQ2eAC4Ie62tfxnekpH5xqrFpdhGqbTMxCa9g/XCJfCYCohsG8xhjNaYfBkXJUP8FSsvQ1ACHH25bLYl2zE7O3B7O1BtbehkklUIhH9Z1cqEY6OoQ8fJti3H//5rfibN0P/wFmdpnZdrBUXYV60HHPhAoyuLoxsFpXJgGODbYPvg+ehx8fRI6OEhw8T7juAv+Ml/Oeeg4HBszrneqm2VuxN12KtWomxaBFGQwPEY1AsEQ4OEu7Zg//0ZryHH0EfOXqup3tB0IaBtWY15uJezN5FGN3dqEwGFY+jEvHo+8Xz0OVK9D0+MIDu6yM8eAh/63b8LVtgaPhcPw0hhDhnJFAgzmtKKQwFQdknk7K5amkjm5Y3s7AxTljdamDVmbY/tVXeC/DCkOuXNrJxQeaYNicKEhxzfT3DTVnw26aBa0VFFie6tgxFe9qlM+MyMlIi1FG2g+LYugpCCDEXtOvi3HYLzg2bMFeuwDBOkYvlOBiZDMzrwt64Ad58B2EYEmzdRuVHP6Fy970oz5ubeQLWpZfg3n4b1qWXYLjuqS9wnOiRTEJbGyxdcsyX/R07qNz7Eyo/vAcKhRnPL3v/j+tue6ITBoxlS4m99y6cyy498UXpFEY6Bd0LcK69hvDDH8J/4klKX/064Qsvnum0a2Y6/zPp50yun87pDMaSxbhveiPWNVdjZhtO3diyIB4HGjDb2477svfMZio/uJvKT+5DSSRfCPEaI4ECcZ7ThDoqUNDcEOP2Na0sbUlEX5puqv6U9rapaEzarOxIsbApMdlkFmoFTGxbgOiH3JGiT9I1WTcvQy5u19o1JR3a0i4vQJQWARIkEELMKe26xN7xdpw333H6RdQpGIaBsWol9qqVxN7za5T/4Z8of+vbqHD2znw116wm/tu/ibVk8az1aS1ZgrVkCbG7fpXS3/0D5X/513OyANQxl/iHPkjsjtundZ1hmjiXX4Z16SV4P7yHwl99EVUqz9EsLzANDcR//X3Yt9586sDXNNgXr8W+eC3ur7ydwp9/gfD5LbPSrxBCXAikRoE4bykFOgQdhOBaLGpLcnVvjrZ09Y7SSbYInLS/KR+3pR3WdqXpaU7QEJ+Ml83WP4iJeIMCOhpcVnakWNuVJh2bHCsTs2hK2Bgo0JM1EYQQYi6YG9aR+dr/T/w9vzajIMFx/eZyJD78IdJf+WuM3p4Z96cB9713kfz8Z2c1SDCVkU6R+M0PkvqzP0HH43MyxsmotlbSX/qraQcJpjIMA/eNt5H+8pdQ7e2zOLsLk1rYTforf437hltnLUgwldXTQ+rzn8W58y2z3rcQQpyvJFAgzluGUhCGKC9gQS7GxZ1pFjbGMYyoBoDBK081qF9vc4LXL2umPePMTRHBap+2qbhpeRM3X9TMglwc25wcLO4YpGJm7TkYRvSYTvBjYiilpjyYfrKFEOLVSwOxD7yP9Of+FLOjY87GsXoWkfriF7BvvfmM+9BA4mMfJf5r75qTBd8r2RvXk/7Cn8MsBk5ORXW0k/riF7AWLZyV/qwF80l96Quo7gWz0t+FyFiymPQX/hyzpXlux7EsEh/+EM7b3jqn4wghxPlCAgXi/KWAMHosaoqzpDWBY0VL4FceXzhd2bhNd1OMlGvN6V1801C0Zxxa0scHJCb+HITRaQ7l0Qp+wUcHIYahqgED9Yprqic7GNXTGIiCJjrQk48wOgXimLYT/UkEQYjXFG0YJP7jx4m98x1nZTzDdUl+/Pdw3vUrZ3R97L3vxn3DrbM8q1Ozliwm+d/+ED3XgYlUitTnPoPZ1DSr3Zq5HKnPfQbV2jKr/V4QkgmSn/yDqIbGWRL74Psxli09a+MJIcS5IoECMWcm7nRPp62akrI/cXyAUoruxjgLm+K1UwFmuqPUNhVx28QyzjwroR6GUtimgalU9HSmfC1fDhgvB8Rdi2wuxoKmOAnHROnouEStNQp97GsYRsGAMAijNoGO6htMdK6jNoQh2g8Jqw8dhNFreZoTG4QQry6Jj30U9/WvO/vjvv+9OP9uesEJc81q3DMMMMyUvXYN8V9//5yOkfjYRzE7O+ekb7O5meQn/yvaem2Vnkp87KNzmiVzIoZlEf/wh87qmEIIcS5IoEDMCUOBYShMpTAMTnwnu3rD3Kje+Tard8kn75RXl9WmYn4uxoJs7NhAwgydrfpVurqAf2V+wIGhEofHyixqT/Luaxfw8Tcs5pIlORKOCXkPyj5ojaGi10ZpjfYCdMGDcQ8KHnhBFACwFI5jYDtGdFZkoKHowXgFxivovIeuBOhqf8YcB0iEEOee88tvw53BNoCZSvz6+7BuvL7u9vHf/tBZ2W5wMs6db0bNnz93/V93zZz1DWAtX0b8PXfN6RjnE2PFRTibrjsnY9urV6E6pDaEEOLV7bUVehZzSlWLC2oNoR+CH0AYcszy+ASr03Dqgt1Q0ULXVChlRJ1aBrmUQ1PSqVUluJDuiqvaL8fWH3h5oMih0TLXL2nk5pUtrOxM0ZGN8cSiYZ58eZjH94wwMlYhUGH0IpmKWMxkXmuCroYYTWmHTMImHbdoTNgkXRPTMCh5IYWKT6HoMzBW4eBwib1DRfaNVigWPYIwAMvAsA2qdRTluAUhTmGmR7+dC8biXmIfeO+0r/Oe+gWVn9yHv2UrYV9/FKxsacFasRz7xuuxNm6Y1mI+8bv/nrFtL6APHjxlO/PiNVhLlpyyzVTh2BiVe3+M99QvCPfsIxwagnIZLAsj24C5ZDH29Zuwr78OwzTr6tOwLOLvezeFT/z3uucxU/7uPVTuvhfv8SfQR/vQgY/R0oq1YR3uG26ddjFH5+1vpXzPj9D79s3RjM8f8ffWHxQJR0cp/cu38B99jGDf/uh7JRbDyOUwl/Ti3HD9tAM51vp1eD+4e7rTFkKIC4YECsSMGYZCaQj9AF30AYhlY6zqSLG+K8PC5jitaYdMzMI2Ve2ueskPGSv5DI5XODpe4cBwiT2DJXYNFjkyXIZ8BYBU2iHhmDjm1B8zL6CUAgAdFS20TEX/eIV7t/czWPBY3p7iykVZWtMOoY6SKhoTNq9b1kxPU4IfPH+Uf33mCKs6UtywrIkrFuVoTNq4liLpWLVTFPrGPV4+OMa+4RKDeQ/HMuhocGlOOlzTm+OONa3kyz5bDo3znWePcs/WPnbsGwPTQNkGylCTWz2EEBc055bXY1+0vO72/os7GP/o78P4+GnbBpufZfyDv0Xyc3+KvXxZXf3bK1fg3HQj3o//7aRtrFUr655v4XOfPyZIcCrhCy+S//3/SOqLX8Bw3dO2NwwD+4ZNVP7+H+uez3SFvk/hk3+E/+BDp3wnU0DlG98kPHQoWsDWGfixN11L6ctfQR/tm5X5no+c6zfV1S70PPJ/+N9qQYJT8R94EO8n99Vd08PoPLu1EYQQ4myTQIE4cwoFitALoy0GStHVmmR5W5KV3Q2s6kyxpCVJe8ahMWGTcswoUIAiRFPxNflKwGjJZ6jg0V/wODJaZv9wmb2DRfb15dlxtEAx0LX0/QssPABM1kKYOF1h71CJH20foCvrclVPjs6GGABhqNEqOikhG7dYPz+DYxk0p116muOs7UzTnpn8Qbc/X2HH0QLbj+TZ3V/gwFCJvnyFkXKAoaHRMuhsjLOgNcHC5gRrOlOsn58hFbPoysW45/k+ntgzQr7goVwzyiyQWIEQFzQNuL/y9rrb+3v31R0kqMkXyP/u70fH/HV313VJ7L33UfnJfaiT/CdjTKMgXXjg4LTeC8Kdu6h89wfE3vaWuto7N1w/p4GC0hf/Bv/Bh+pu7z/4EKUv/y2J3/xgXe0Ny8K+6XVU/mHunsO5Zm+6tq523t33ovfsrbvfyk/+rf5AQfPcHscohBDnmgQKxBlTRHfAgyDEMRStjXFuWdXCHWvauK43Sjp2/LfXxM+IllI4JqRck7b08SmVQ0WPLYfG+cZTh7l7Sx+er6l4GtO58IrwhVpjVrddDBV9th8tsGSwxK9e0sEvr2/HMqJnZBqqtlifuGZVR4pVHanj+hwseNz3wgDfePoId2/tpzBWhlBjOSaJpI2uBOT7ioSmgoRNQ0OMt61r49cu7eDyhVlWtKdY0ZHi03fv5NFdQ9E2jyk1JoQQFybr8kvrXryHQUDhM5+dXpBgQr5A4TOfJfWXn6+rBoDZ0YF97dX4Dzx44gbxWN1D21dfhX//A3W3Byh/7/s4b7gFPTRMODSEHhoiHBxCDw5Ffx4cIhwcjD4/NDRn7zPe1m2Uv/Xtafdf/ua3cG6+Cau3p672zg2bXtWBgrHf+DBGcxNGUxOquQmjsRGjeeLj6u9NjZS/871p9Rvs2Fl3W5VJT3faQghxQZFAgTgjhqkIKwFBOSDbEOPapY2867IuVnem6GhwjwsShFozUPAYKfqAIhOzyMUnU+dfKRe3uWJRloPDZbYdGqfkBfSPl5mXi1drC2jO9/yC6HTHapCAKGPgH544yNZD47x1bRtX9UQnHIRag1aTJzooMFBoNCcKi2w+MMaPt/fzwy19bD9SoOyFUApAQaohxvuunM+y1gTb94/xT784zMFD41gNcP+OQQ6PlXn/5fO4ujfLNT053n15F66heGBrP1gGyjVkC4IQFzD3tlvqbuvd8yPCLVvPeKxw63a8H96De/sb6mrv3HrzyQMFngd1ptYnPv67FHNZKt//Icqrb5e43ruP0dvuqKvtXL6zlL729TPqX4Uhpa99ndR//0Rd7a3eHsg2wPDIGYx2/lOlEnr/AYL9B2a1Xz06Wv8c4vFZHVsIIc43EigQ01NN/w+9EEtFWQQ3rGzhl9a1c/uqlmPqCAwVfPYMFdk7VOLQcImB0TIjRR8FZGIWTRmXjqzLvFyceVmXpoSNaVTvaFcX2CvaU2xY0MBIyWdHX4H5uQvnjVkR3aEPNRwdK7P1cJ49g0WaUw6vX97MoqaT30GrZRag0USZG2go+5qhgkcl0PQ2J1jYlABgT3+Bl/oKjJcCiuWAzoYYGxflwDH57jNHKHgBtqHwAs292/pJOAY3LW/mjataGByv8Oy+UYZKPmGgUYZsQRDiQqRtG+uSjXW3L3/7uzMes/zt79YdKLDWr4NEAgqF474W9g9gzK+zQGI8TvIjHyb+vnfjPfhQ9HjqF6hyeTpTP+uCgQH8J54640CE9+hjhOPjGKnjs8xOxFq75uSBGXFCKgjqb1xHzQshhLiQSaBATItRvccdFD1am+PctradD29awNqudHRnvKrshzzy8hD//PQRfrpjkAP9BcKSjwp0LRnASth0tsS5bGGW21e3cP2SRjoyLoZSVAIdbWfIOFy3tJEHXhrkuUNjXLe4EctU532Vfq0nF/tDBY+fvTTEvdv6uWxRA1f35ljSGsdQiiCczDh4JaWi13oid8ILNaMln7a0y5vXtLGoKU7MNih6ATv6i/zj4wf5ys/28qX7dnN0pMyX3rWK37p2Ae1ph/9x/24u7W5g09JGvv74Qe57cYiL5zXQlY2yQX70Qj9P7RpmrOBjxG1ChWQWCHGBsTaux6jzLqe/4yXCHS/NeMxw5y78F3dgLT390YaG42CuXU3wyGPHfS3Y8RJWnYGCWn+pFO6tN+PeejNhpULw/Ba8p57Gf2YzwfYXprfoOwv8hx89aY2GeijPx3v0cdzX3VBXe7O3RwIF9WpsxL72apxbXl//NdM4JlQIIS5EEigQdVOGIvRDjFCTSNlcu6yJD14znz+8tZffu2kRH7hmPm9c1Upj0q61jY7QDNk7WOSFI3l29RcYK/mYhiKXsFnammRJS5KWlMu+oRL7h0q0VoNF83NRNep9g0W2HBqnHOj6978K8RpS+vt/JBgZqbu9vXwZqb/5IubFa0/b1li9itRf/xX2yhV191954EGCp5856df1vv1UHnyo7v6ca64i+en/DnUef6hNE/eud+G8/c66x6j87MG6254J9423kfij/wanKZpoXX0lyc/9KUY6VXfflW99GzWNu/lzRY+P193Wed2NdbcNp1EM0l6zmvhv/+Yp38/MNatJf+kvsXp66u53wnT+XoQQ4kIjNQrOhepi2lBgWwaOpfAVVLQmAJ7aM8I2Ve2U7hzuX9fO15c38Rvn9XNjbQuJhgZ2DSXJxm2aEjZXdKTZPlCkqynO0tYEy1pDbNOgYml7j10O5Pj713byj5c38+d39dKftXno6OvxA9l/2qC+2q9U6H3K6lDNoS0e4pLNxG2D7mRwtMROyWe+4vL0sSl6Uhb7xzKcnyyyqS/BQxuy3LKylYl8jZauIEYiYurBwZES52aqbOmKsb4rTtjUqblp22C/y+Rshclij3l/VvR92+jX3Rvn39//x5QST/ZN0BYzSccMAl4AACAASURBVGZz/p1v7uLzR+YYyPsw/HjJ5mB75y5XqH1/U7qHhUoIq7i/v/mD4/zYwFSu7F2/5u40x0/U87xS3vP3nO5/1qO+bA9/eJ7m+7O80w+O8cTBCSZOZ/ngzi7e/eU1/fL9g/z6Iwc5mSyQixqMbz3cR2B1b6f0h7tP5nE84HquT/vT6/r6aJG7T+c4Mllgx+EkiUBC/tHn0xY3I2T3tV2P1B/e+lO12/d1x+N4x/u25Xl8L8/ZfJXnjs/zU7v6qZgt0Bkz0WqLNDRz+I9L++v5XnO93+D5Xn+N9vM839/i+Z88sMfH/3L2t8n52/mX99/mX5+/zS/e9535v/4/u+/zD5/f5r9/f5r/8r3/eN4X8w8f533m8fO8zT++f/N+31u8H+P/3vL928Z6+1v/+f/9X8z/fXn/x5/3/97xT6Z5/e/3m9n/d3l+y/f/m7yfn/8/u/74//z/v8X7+1//M9yP//P+/z/e/v9L+f+v+b///xX/b7b+Bv/f/v7P///v83///z7/j7b/B/v7/r/N/v///i63/g//w/2/7/ff2/+8eP///m/+783/4/2f8v7f/e/f4f0r//X/+f7+X8j6+5v/u/Vv838+v+P8v4/9P+///e9P+f9//t6X7+/5f//73t//y/z7/r+//H/j97f/8/+1v+//b/t/9v//+//3/V//h/+v//T/+//9f//P/9///+//f///8f//H///9f//P///f///z///3/+///+/y///+///f///9f//v9f//v9///X+H//f//X///1///7///3///3///5f//v/7//r///v//3//v//7//P/3///3///9f//9f//f////3+//v///1v//v/+//7//v/9///9v///1///5///+//f///f///1v///3///9///7//9v//+v//+P//xH//3/+///+//f///9v///9f///1v///3///9///7//+v///v///3///7///7//P/3///3///1///5///+//f///f///9v///3///9///7//x///+//H/z/6///+//X////9///9f//X/n/6v//+H//j///v/8///+//f//r///n/5/+f//v///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n///n/8f//X//7/wD/AA==',
    tableHeaders: {
        units: ['name', 'building', 'floor', 'description'],
        supplies: ['item_name', 'description'],
        supply_arrivals: ['arrival_date', 'supply_id', 'quantity_arrived', 'notes'],
        supply_deliveries: ['delivery_date', 'supply_id', 'unit_id', 'quantity_delivered', 'notes'],
        equipment: ['name', 'serial_number', 'status'],
        hazardous_waste: ['date', 'weight_kg', 'waste_type', 'unit_id', 'container_type'],
        special_waste: ['date', 'weight_kg', 'waste_type', 'unit_id', 'container_type'],
        assimilable_waste: ['date', 'weight_kg', 'unit_id'],
        recycling_log: ['date', 'material_type', 'weight_kg'],
        containers: ['container_reference', 'container_type', 'waste_usage_type', 'capacity_liters', 'unit_id'],
        waste_removal_agreements: ['razon_social', 'rut_proveedor', 'licitacion_id', 'price_per_kg_special_iva', 'price_per_kg_hazardous_iva', 'start_date', 'end_date', 'status'],
        monthly_invoices: ['purchase_order_number', 'agreement_id', 'billing_cycle_start', 'billing_cycle_end', 'pre_invoice_kg_special', 'pre_invoice_kg_hazardous', 'pre_invoice_amount_iva', 'status'],
        waste_pickups: ['pickup_date', 'agreement_id', 'guides', 'notes'],
        equipment_maintenance: ['equipment_id', 'service_date', 'service_type', 'provider', 'cost', 'description'],
        equipment_loans: ['equipment_id', 'date_of_delivery', 'withdrawing_employee', 'status', 'return_date', 'returning_employee'],
        // Los perfiles de usuarios se gestionan a través de la tabla 'perfiles'
        users: ['nombre_completo', 'email', 'password', 'rol', 'establecimiento_id'],
        // NUEVA TABLA AÑADIDA
        unit_pickups: ['pickup_date', 'pickup_time', 'unit_id', 'waste_type', 'user_email', 'observations']
    },
    headerTranslations: {
        date: 'Fecha', weight_kg: 'Peso (kg)', waste_type: 'Categoría REAS / Tipo', unit_id: 'Unidad', material_type: 'Material',
        container_reference: 'Referencia/Lugar', capacity_liters: 'Capacidad (L)', container_type: 'Tipo de Contenedor',
        item_name: 'Insumo', description: 'Descripción', razon_social: 'Razón Social', rut_proveedor: 'RUT',
        licitacion_id: 'ID Licitación', start_date: 'Inicio Contrato', end_date: 'Fin Contrato', status: 'Estado', name: 'Nombre',
        building: 'Edificio', floor: 'Piso', supply_id: 'Insumo', quantity_delivered: 'Cant. Entregada',
        quantity_arrived: 'Cant. Recibida', delivery_date: 'Fecha Entrega', arrival_date: 'Fecha Recepción', notes: 'Notas',
        equipment_id: 'Equipo', date_of_delivery: 'Fecha y Hora Entrega', withdrawing_employee: 'Retira',
        return_date: 'Fecha Devolución', returning_employee: 'Devuelve', serial_number: 'N° de Serie',
        service_date: 'Fecha Servicio', service_type: 'Tipo Servicio', provider: 'Proveedor', cost: 'Costo',
        agreement_id: 'Convenio', purchase_order_number: 'N° Orden de Compra', billing_cycle_start: 'Inicio Ciclo',
        billing_cycle_end: 'Fin Ciclo', price_per_kg_special_iva: 'Precio Kg Especial (IVA incl.)',
        price_per_kg_hazardous_iva: 'Precio Kg Peligroso (IVA incl.)', pickup_date: 'Fecha de Retiro', guides: 'Guías (N°/SIDREP/Kg)',
        waste_usage_type: 'Uso para Residuo', pre_invoice_kg_special: 'Kg Especial Prefactura',
        pre_invoice_kg_hazardous: 'Kg Peligroso Prefactura', pre_invoice_amount_iva: 'Valor Prefactura (IVA incl.)',
        email: 'Correo',
        password: 'Contraseña',
        role: 'Rol',
        nombre_completo: 'Nombre Completo',
        rol: 'Rol',
        establecimiento_id: 'Establecimiento',
        pickup_time: 'Hora Retiro', 
        user_email: 'Usuario', 
        observations: 'Observaciones'
    },
    wasteTypeOptions: {
        hazardous_waste: [ 'ACIDO CLORHIDRICO', 'ALCOHOL', 'ALCOHOL GEL', 'ALEACION PARA AMALGAMA DENTAL', 'AMPOLLAS Y FRASCOS CON RESTOS DE MEDICAMENTOS', 'AMPOLLETAS FLUORESCENTES', 'APOSITOS CON FORMALINA', 'ARENA CONTAMINADA CON HIDROCARBUROS', 'ASERRIN CONTAMINADO CON HIDROCARBUROS', 'ATROPINA SULFATO', 'BATERIAS DE NIQUEL-CADMIO', 'BATERIAS DE PLOMO', 'BATERIAS NI - MH', 'CAL SODADA', 'CILINDROS VACIOS DE GAS ISOBUTANO PROPANO', 'CITOTOXICOS', 'DETERGENTES INDUSTRIALES', 'ELEMENTOS CON PLOMO', 'ENVASES CON RESTOS DE SUSTANCIAS PELIGROSAS', 'ETER ETILICO', 'FENOL', 'FORMALINA', 'INHALADORES', 'LIQUIDO REVELADOR', 'MEDICAMENTOS VENCIDOS', 'MERCURIO CONTENIDO EN TERMOMETROS O ESFIGMOMANOMETROS', 'MERCURIO CROMO', 'MEZCLA DE AMONIOS CUATERNARIOS', 'NITRITO DE SODIO', 'ORTOFTALDEHIDO', 'OXIDO DE ETILENO', 'PEROXIDO DE HIDROGENO', 'PILAS', 'PLACAS DE PLOMO', 'PLATA NITRATO', 'REACTIVOS DE LABORATORIO', 'RESIDUOS DE ACEITES Y LUBRICANTES (EXCEPTO LAS EMULSIONES)', 'SOLUCION PAF', 'SOLVENTE DE QUEMAR','SOBRANTES Y CONTAMINADOS CON MEDIO DE CONTRASTE (YODADO)', 'TERMOMETROS CON MERCURIO', 'TONER', 'TUBOS FLUORESCENTES', 'VIOLETA GENCIANA CRITAL', 'YODO SUBLIMADO', 'SOLUCION GIEMSA DE DESECHO', 'OLEOFINA' ],
        special_waste_categories: { 'CORTO-PUNZANTES': [], 'CULTIVOS Y MUESTRAS ALMACENADAS': [], 'PATOLOGICOS': [], 'RESTOS DE ANIMALES': [], 'SANGRE Y PRODUCTOS DERIVADOS': [] },
        recycling_materials: ['Papel', 'Cartón', 'Aceite']
    },
    containerOptions: [ { name: 'PRO1 (1 L)', capacity: 1, category: 'Contenedor Cortopunzante' }, { name: 'PRO3 (3 L)', capacity: 3, category: 'Contenedor Cortopunzante' }, { name: 'PRO6 (5 L)', capacity: 5, category: 'Contenedor Cortopunzante' }, { name: 'PRO10 (10 L)', capacity: 10, category: 'Contenedor Cortopunzante' }, { name: 'PRO15 (15 L)', capacity: 15, category: 'Contenedor Cortopunzante' }, { name: 'REBOX2 (2 Gal)', capacity: 7.57, category: 'Contenedor Cortopunzante' }, { name: 'REBOX3 (3 Gal)', capacity: 11.36, category: 'Contenedor Cortopunzante' }, { name: 'REBOX4 (4 Gal)', capacity: 15.14, category: 'Contenedor Cortopunzante' }, { name: 'Contenedor 15L', capacity: 15, category: 'Contenedor General' }, { name: 'Contenedor 20L', capacity: 20, category: 'Contenedor General' }, { name: 'Contenedor 30L', capacity: 30, category: 'Contenedor General' }, { name: 'Contenedor 50L', capacity: 50, category: 'Contenedor General' }, { name: 'Contenedor 80L', capacity: 80, category: 'Contenedor General' }, { name: 'Contenedor 120L', capacity: 120, category: 'Contenedor General' }, { name: 'Contenedor 240L', capacity: 240, category: 'Contenedor General' }, { name: 'Contenedor 320L', capacity: 320, category: 'Contenedor General' }, { name: 'Contenedor 360L', capacity: 360, category: 'Contenedor General' }, { name: 'Contenedor 660L', capacity: 660, category: 'Contenedor General' } ],
    navItems: [
        { id: 'dashboard', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2z"></path></svg>', text: 'Dashboard' },
        { id: 'estadisticas', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18"></path></svg>', text: 'Análisis y Estadísticas' },
        { id: 'waste', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>', text: 'Residuos' },
        { id: 'recycling', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>', text: 'Reciclaje' },
        { id: 'inventory', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>', text: 'Inventario' },
        { id: 'wastePoints', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>', text: 'Puntos Residuos'},
        { id: 'equipment', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m12 0a2 2 0 100-4m0 4a2 2 0 110-4M6 20v-2a2 2 0 114 0v2m4-2v-2a2 2 0 114 0v2m-4-4v-2a2 2 0 114 0v2"></path></svg>', text: 'Equipos' },
        { id: 'agreements', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>', text: 'Convenios' },
        { id: 'users', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a4 4 0 00-5-3.9M9 20H4v-2a4 4 0 015-3.9M16 11a4 4 0 100-8 4 4 0 000 8zM8 11a4 4 0 100-8 4 4 0 000 8z" /></svg>', text: 'Usuarios' },
        { id: 'settings', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066 2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>', text: 'Gestión de Unidades y Ubicaciones' }
    ]
};
window.APP_MODULES = {};
let unitsCache = [], suppliesCache = [], equipmentCache = [], agreementsCache = [];
let availableDates = {}; // Objeto para almacenar años y meses con datos
let isUploading = false;

async function refreshCaches() { await Promise.all([ loadUnitsCache(), loadSuppliesCache(), loadEquipmentCache(), loadAgreementsCache() ]); }
async function loadUnitsCache() {
    try {
        const allUnits = await fetchAll(
            window.db.from('units').order('name', { ascending: true }).select('id, name, building, floor')
        );
        unitsCache = Array.isArray(allUnits) ? allUnits : (allUnits?.data || []);
    } catch (e) {
        console.warn('Unidades: tabla no encontrada o error al cargar datos. Se utilizará lista vacía.', e);
        unitsCache = [];
    }
}
async function loadSuppliesCache() {
    try {
        const allSupplies = await fetchAll(
            window.db.from('supplies').order('item_name', { ascending: true }).select('id, item_name')
        );
        suppliesCache = Array.isArray(allSupplies) ? allSupplies : (allSupplies?.data || []);
    } catch (e) {
        console.warn('Insumos: tabla no encontrada o error al cargar datos. Se utilizará lista vacía.', e);
        suppliesCache = [];
    }
}
async function loadEquipmentCache() {
    try {
        const allEquipment = await fetchAll(
            window.db.from('equipment').order('name', { ascending: true }).select('id, name, serial_number, status')
        );
        equipmentCache = Array.isArray(allEquipment) ? allEquipment : (allEquipment?.data || []);
    } catch (e) {
        console.warn('Equipos: tabla no encontrada o error al cargar datos. Se utilizará lista vacía.', e);
        equipmentCache = [];
    }
}
async function loadAgreementsCache() {
    try {
        const allAgreements = await fetchAll(
            window.db.from('waste_removal_agreements').order('razon_social', { ascending: true }).select('*')
        );
        agreementsCache = Array.isArray(allAgreements) ? allAgreements : (allAgreements?.data || []);
    } catch (e) {
        console.warn('Convenios: tabla no encontrada o error al cargar datos. Se utilizará lista vacía.', e);
        agreementsCache = [];
    }
}
async function imageToBase64(url) { try { const response = await fetch(url); const blob = await response.blob(); return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); } catch (error) { console.error('Error converting image to Base64:', error); return ''; } }



// ---------------------------------------------------------------------------------
// PARTE 3: FUNCIONES CRUD Y HELPERS GENERALES
// ---------------------------------------------------------------------------------

/**
 * Genera un UUID v4 compatible con contextos no seguros (HTTP).
 * Reemplaza a crypto.randomUUID() cuando no está disponible.
 */
function generateUUID() {
    // 1. Intenta usar la API nativa si está disponible (Contextos Seguros/HTTPS)
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    
    // 2. Fallback robusto para contextos no seguros (HTTP) usando Math.random
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Helper function to fetch ALL records from a query, handling Supabase's pagination.
 * @param {object} queryBuilder - The initialized Supabase query.
 * @returns {Promise<Array>} An array with all found records.
 */
async function fetchAll(queryBuilder) {
    const BATCH_SIZE = 1000; // Supabase default limit
    let allData = [];
    let from = 0;

    while (true) {
        const { data, error } = await queryBuilder.range(from, from + BATCH_SIZE - 1);

        if (error) {
            // Si la tabla no existe o no está en el esquema, devolvemos lista vacía en lugar de lanzar error
            const msg = error.message || '';
            if (msg.toLowerCase().includes('could not find the table') || msg.toLowerCase().includes('schema')) {
                console.warn(`${queryBuilder.table || 'unknown'}: tabla no encontrada o error. Se utilizará lista vacía.`, error);
                return [];
            }
            console.error("Error fetching paginated data:", error);
            throw error;
        }

        if (data && data.length > 0) {
            allData = allData.concat(data);
            from += BATCH_SIZE;
        } else {
            break;
        }

        if (data.length < BATCH_SIZE) {
            break;
        }
    }

    return allData;
}


/**
 * Sets up event handlers for a generic CRUD form and list.
 * @param {string} tableName - The name of the Supabase table to manage.
 */
async function setupCRUD(tableName) {
    const form = document.getElementById(`form-${tableName}`);
    if (!form) return;

    // [FEATURE] Setup table header sorting
    setupTableSorting(tableName);

    await loadAndRenderList(tableName, 0);

    // Lógica específica para convenios (fechas)
    if (tableName === 'waste_removal_agreements') {
        const startDateInput = form.querySelector('input[name="start_date"]');
        const endDateInput = form.querySelector('input[name="end_date"]');
        if (startDateInput && endDateInput) {
            startDateInput.addEventListener('change', (e) => {
                const startDate = new Date(e.target.value + 'T00:00:00');
                if (!isNaN(startDate.getTime())) {
                    startDate.setFullYear(startDate.getFullYear() + 2);
                    endDateInput.value = startDate.toISOString().split('T')[0];
                }
            });
        }
    }

    // Lógica específica para contenedores
    if (tableName === 'containers') {
        const typeSelect = form.querySelector('select[name="container_type"]');
        const capacityInput = form.querySelector('input[name="capacity_liters"]');
        if (typeSelect && capacityInput) {
            typeSelect.addEventListener('change', (e) => {
                const selectedOption = e.target.options[e.target.selectedIndex];
                if (selectedOption && selectedOption.dataset.capacity) {
                    capacityInput.value = selectedOption.dataset.capacity;
                }
            });
        }
    }

    // Lógica para añadir guías dinámicas en retiros
    if (tableName === 'waste_pickups') {
        const addGuideBtn = document.getElementById('add-guide-btn');
        if (addGuideBtn) {
            addGuideBtn.addEventListener('click', () => {
                const container = document.getElementById('guides-container');
                const guideCount = container.children.length;
                const newGuideHTML = `<div class="grid grid-cols-1 md:grid-cols-4 gap-2 border-t pt-3 mt-3" id="guide-group-${guideCount}">
                    <input type="text" name="guide_number_${guideCount}" class="form-input" placeholder="N° Guía" required>
                    <input type="text" name="guide_sidrep_${guideCount}" class="form-input" placeholder="N° SIDREP" required>
                    <input type="number" step="any" name="special_kg_${guideCount}" class="form-input" placeholder="Kg Especiales">
                    <input type="number" step="any" name="hazardous_kg_${guideCount}" class="form-input" placeholder="Kg Peligrosos">
                </div>`;
                container.insertAdjacentHTML('beforeend', newGuideHTML);
            });
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true; button.innerHTML = '<span>Guardando...</span>';

        const formData = new FormData(form);
        let record = Object.fromEntries(formData.entries());

        // Procesamiento especial para guías en retiros
        if (tableName === 'waste_pickups') {
            const guides = [];
            for (let i = 0; i < 100; i++) {
                if (record[`guide_number_${i}`]) {
                    const specialKg = parseFloat(record[`special_kg_${i}`]) || 0;
                    const hazardousKg = parseFloat(record[`hazardous_kg_${i}`]) || 0;
                    if(specialKg > 0 || hazardousKg > 0) {
                         guides.push({
                            number: record[`guide_number_${i}`],
                            sidrep: record[`guide_sidrep_${i}`] || 'N/A',
                            special_kg: specialKg,
                            hazardous_kg: hazardousKg
                        });
                    }
                    delete record[`guide_number_${i}`];
                    delete record[`guide_sidrep_${i}`];
                    delete record[`special_kg_${i}`];
                    delete record[`hazardous_kg_${i}`];
                } else { break; }
            }
            record.guides = guides;
        }

        // Limpieza de campos vacíos
        Object.keys(record).forEach(k => { if (record[k] === '' || record[k] === null || k === 'billing_period_selector' || k === 'waste_category') delete record[k]; });
        
        let error = null;

        // [CORRECCIÓN] Manejo especial para la creación y edición de usuarios (perfiles)
        if (tableName === 'users') {
            // 1. Usar Auth.signUp para crear el usuario y encriptar contraseña
            const signUpResult = await window.db.auth.signUp({
                email: record.email,
                password: record.password,
                name: record.nombre_completo || record.name
            });
            error = signUpResult.error;

            if (!error) {
                // 2. Si el registro fue exitoso, actualizamos rol en la tabla perfiles
                try {
                    // Intentamos obtener el id del usuario recién creado consultando la tabla perfiles
                    const { data: perfilList } = await window.db.from('perfiles').eq('email', record.email).select('id');
                    if (perfilList && perfilList.length > 0) {
                        const perfilId = perfilList[0].id;
                        await window.db.from('perfiles').update({
                            rol: record.rol || record.role,
                            establecimiento_id: record.establecimiento_id || null,
                            nombre_completo: record.nombre_completo || record.name
                        }).eq('id', perfilId);
                    }
                } catch (updateErr) {
                    console.error("Error actualizando rol/nombre en el perfil:", updateErr);
                }
            }
        } else {
            // [ESTÁNDAR] Para cualquier otra tabla, usamos inserción directa con ID generado
            // CORRECCIÓN: Usamos generateUUID() para compatibilidad con HTTP
            record.id = generateUUID();
            const result = await db.from(tableName).insert([record]);
            error = result.error;
        }

        if (error) {
            console.error('Error on insert:', error);
            alert(`Error al añadir: ${error.message}`);
        } else {
            form.reset();
            if(form.parentElement.tagName === 'DETAILS') form.parentElement.open = false;

            if(tableName === 'waste_pickups') document.getElementById('guides-container').innerHTML = '';
            
            // Actualizamos las cachés y recargamos
            await refreshCaches();
            await loadAndRenderList(tableName, 0);
            if (document.getElementById('dashboard-container')) {
                 await window.APP_MODULES.dashboard.loadDashboardData();
            }
        }
        button.disabled = false; button.innerHTML = `Añadir ${tableName === 'waste_removal_agreements' ? 'Convenio' : 'Registro'}`;
    });

    if (!tableName.includes('waste')) {
        const searchInput = document.getElementById(`search-${tableName}`);
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                loadAndRenderList(tableName, 0, { searchTerm: e.target.value });
            });
        }
    }

    const csvInput = document.getElementById(`csv-upload-${tableName}`);
    if (csvInput) csvInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleCsvUpload(e.target.files[0], tableName, e.target); });
}

async function loadAndRenderList(tableName, page = 0, filters = {}, sort = {}) {
    const listContainer = document.getElementById(`list-${tableName}`);
    if (!listContainer) return;
    listContainer.innerHTML = `<tr><td colspan="100%" class="text-center p-4">Cargando...</td></tr>`;

    // Mapa para determinar qué tablas necesitan uniones para mostrar nombres relacionados
    const selectMap = {
        'hazardous_waste': 'units',
        'special_waste': 'units',
        'assimilable_waste': 'units',
        'containers': 'units',
        'supply_deliveries': 'supplies,units',
        'supply_arrivals': 'supplies',
        'monthly_invoices': 'waste_removal_agreements',
        'waste_pickups': 'waste_removal_agreements'
    };

    // Determinar el campo de ordenamiento y la dirección
    const sortBy = sort.by || 'created_at';
    const sortAsc = sort.asc === undefined ? false : sort.asc;
    // Crear una instancia de consulta
    let query = db.from(tableName).order(sortBy, { ascending: sortAsc });
    // Aplicar filtros de fechas según el campo apropiado para la tabla
    let dateField;
    if (tableName === 'monthly_invoices') dateField = 'billing_cycle_end';
    else if (tableName === 'unit_pickups') dateField = 'pickup_date';
    else if (tableName === 'supply_deliveries') dateField = 'delivery_date';
    else if (tableName === 'supply_arrivals') dateField = 'arrival_date';
    else dateField = 'date';
    if (filters.dateStart) {
        query = query.gte(dateField, filters.dateStart);
    }
    if (filters.dateEnd) {
        query = query.lte(dateField, filters.dateEnd);
    }
    // Filtro por unidad (lista de IDs)
    if (filters.unitId && filters.unitId.length > 0) {
        const ids = Array.isArray(filters.unitId) ? filters.unitId : [filters.unitId];
        query = query.in('unit_id', ids);
    }
    // Filtro por tipo de residuo en las tablas de residuos
    if (filters.wasteTypeSearchTerm) {
        query = query.ilike('waste_type', `%${filters.wasteTypeSearchTerm}%`);
    }
    // Filtro de búsqueda general en nombre o campos similares
    if (filters.searchTerm) {
        query = query.ilike('name', `%${filters.searchTerm}%`);
    }
    // Uniones necesarias para mostrar nombres relacionados
    let selectClause = '*';
    if (tableName === 'hazardous_waste' || tableName === 'special_waste' || tableName === 'assimilable_waste' || tableName === 'containers') {
        selectClause = '*,units(id,name)';
    } else if (tableName === 'supply_deliveries') {
        selectClause = '*,supplies(id,item_name),units(id,name)';
    } else if (tableName === 'supply_arrivals') {
        selectClause = '*,supplies(id,item_name)';
    } else if (tableName === 'monthly_invoices') {
        selectClause = '*,waste_removal_agreements(id,razon_social)';
    } else if (tableName === 'waste_pickups') {
        selectClause = '*,waste_removal_agreements(id,razon_social)';
    }
    // Paginación
    const perPage = window.APP_CONFIG.RECORDS_PER_PAGE;
    const from = page * perPage;
    const to = from + perPage - 1;
    query = query.range(from, to);
    // Ejecutar la consulta
    const { data, error, count } = await query.select(selectClause, { count: 'exact' });
    if (error) {
        listContainer.innerHTML = `<tr><td colspan="100%" class="text-center p-4 text-red-500">Error: ${error.message || 'Error al consultar datos'}</td></tr>`;
        console.error(`Error loading ${tableName}:`, error);
        return;
    }
    const totalCount = count !== undefined ? count : (Array.isArray(data) ? data.length : 0);
    if (!data || data.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="100%" class="text-center p-4 text-gray-500">No hay registros que coincidan con los filtros.</td></tr>`;
        renderPaginationControls(tableName, 0, 0, filters, sort);
        return;
    }
    listContainer.innerHTML = '';
    data.forEach(item => listContainer.appendChild(renderItem(item, tableName)));
    renderPaginationControls(tableName, page, totalCount, filters, sort);
}

function renderPaginationControls(tableName, currentPage, totalRecords, filters = {}, sort = {}) {
    const paginationContainer = document.getElementById(`pagination-${tableName}`);
    if (!paginationContainer) return;

    const totalPages = Math.ceil(totalRecords / window.APP_CONFIG.RECORDS_PER_PAGE);
    paginationContainer.innerHTML = '';

    if (totalPages <= 1) {
        return;
    }

    const prevButton = document.createElement('button');
    prevButton.textContent = 'Anterior';
    prevButton.className = 'btn btn-secondary btn-sm';
    prevButton.disabled = currentPage === 0;
    prevButton.addEventListener('click', () => {
        loadAndRenderList(tableName, currentPage - 1, filters, sort);
    });

    const pageInfo = document.createElement('span');
    pageInfo.className = 'text-sm text-gray-600';
    pageInfo.textContent = `Página ${currentPage + 1} de ${totalPages}`;

    const nextButton = document.createElement('button');
    nextButton.textContent = 'Siguiente';
    nextButton.className = 'btn btn-secondary btn-sm';
    nextButton.disabled = currentPage >= totalPages - 1;
    nextButton.addEventListener('click', () => {
        loadAndRenderList(tableName, currentPage + 1, filters, sort);
    });

    paginationContainer.append(prevButton, pageInfo, nextButton);
}


function renderItem(item, tableName) {
    const tr = document.createElement('tr');
    tr.className = 'border-b hover:bg-gray-50';
    let cells = '';
    
    // Obtenemos los encabezados crudos (incluyendo la contraseña si es la tabla de usuarios)
    const rawHeaders = getListHeaders(tableName, true);

    // ========================================================================
    // SOLUCIÓN: Aplicamos el filtro para la tabla de usuarios
    // Esto alinea el cuerpo de la tabla con la cabecera.
    // ========================================================================
    const headers = tableName === 'users' ? rawHeaders.filter(h => h !== 'password') : rawHeaders;

    headers.forEach(header => {
        let cellValue = item[header] ?? 'N/A';
        // Mapeamos campos de relación a sus nombres amigables. Dependiendo de la consulta, los datos pueden estar
        // anidados (item.units) o aplanados (item.unit_name).
        if (header === 'unit_id') {
            // Caso 1: join con unidades devuelve objeto units
            if (item.units && item.units.name) {
                cellValue = item.units.name;
            } else if (item.unit_name) {
                // Caso 2: join devuelve columna unit_name
                cellValue = item.unit_name;
            } else {
                // Caso 3: no hay join. Buscamos en la caché
                const found = unitsCache.find(u => u.id === cellValue);
                if (found) cellValue = found.name;
            }
        }
        if (header === 'supply_id') {
            if (item.supplies && item.supplies.item_name) {
                cellValue = item.supplies.item_name;
            } else if (item.item_name) {
                cellValue = item.item_name;
            } else {
                const found = suppliesCache.find(s => s.id === cellValue);
                if (found) cellValue = found.item_name;
            }
        }
        if (header === 'agreement_id') {
            if (item.waste_removal_agreements && item.waste_removal_agreements.razon_social) {
                cellValue = item.waste_removal_agreements.razon_social;
            } else if (item.agreement_name) {
                cellValue = item.agreement_name;
            } else {
                const found = agreementsCache.find(a => a.id === cellValue);
                if (found) cellValue = found.razon_social;
            }
        }
        if (header === 'guides' && Array.isArray(item.guides)) {
            cellValue = item.guides.map(g => `<span class="block text-xs whitespace-nowrap" title="Guía: ${g.number} / SIDREP: ${g.sidrep}">${g.number} (${g.sidrep}): ${((g.special_kg || 0) + (g.hazardous_kg || 0)).toFixed(1)}kg</span>`).join('');
             if(cellValue === '') cellValue = 'Sin Guías';
        } else if (header === 'guides') {
             cellValue = 'N/A';
        }
        if (header.includes('date') && cellValue !== 'N/A' && !header.includes('created_at')) {
            try {
                const date = new Date(cellValue);
                if (header === 'date_of_delivery') {
                    cellValue = date.toLocaleString('es-CL');
                } else {
                    cellValue = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).toLocaleDateString('es-CL');
                }
            } catch (e) { /* no-op */ }
        }
        // Formateamos montos de facturas con IVA como moneda chilena si corresponde
        if (header === 'pre_invoice_amount_iva' && cellValue !== 'N/A') {
            const numeric = parseFloat(cellValue) || 0;
            cellValue = formatCLP(numeric);
        }
        if (typeof cellValue === 'string' && cellValue.length > 30 && !cellValue.startsWith('<')) { cellValue = `<span title="${cellValue}">${cellValue.substring(0, 30)}...</span>`; }

        cells += `<td class="py-2 px-3 text-sm">${cellValue}</td>`;
    });

    cells += `<td class="py-2 px-3 flex items-center space-x-2"><button onclick="openEditModal('${tableName}', '${item.id}')" class="text-blue-600 hover:text-blue-800" title="Ver/Editar"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L14.732 3.732z"></path></svg></button><button onclick="deleteItem('${tableName}', '${item.id}')" class="text-red-600 hover:text-red-800" title="Eliminar"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></td>`;
    tr.innerHTML = cells;
    return tr;
}
window.deleteItem = async function(tableName, id) {
    if (!confirm(`¿Estás seguro de que quieres eliminar este registro? Esta acción no se puede deshacer.`)) return;
    
    // SOLUCIÓN: Se corrige el orden de los métodos. Primero se filtra por 'id' y luego se ejecuta la eliminación.
    const { error } = await db.from(tableName).eq('id', id).delete();
    
    if (error) {
        alert(`Error al eliminar: ${error.message}`);
    } else {
        // Refrescamos las cachés para reflejar cambios en listas y selectores
        await refreshCaches();
        await loadAndRenderList(tableName, 0);
        if (document.getElementById('dashboard-container')) {
            await window.APP_MODULES.dashboard.loadDashboardData();
        }
    }
}

function resizeCanvas(canvas) {
    if (!canvas) return null;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.scale(ratio, ratio);
    const signaturePad = new SignaturePad(canvas, { backgroundColor: 'rgb(249, 250, 251)' });
    signaturePad.clear();
    return signaturePad;
}

window.openEditModal = async function(tableName, id) {
    // [CORREGIDO] Se añade .single() para obtener un objeto, no un array
    const { data, error } = await window.db.from(tableName).eq('id', id).single().select('*');
    
    if (error || !data) { 
        alert('No se pudo cargar el registro para editar.'); 
        return; 
    }

    // [SEGURIDAD] Aseguramos que sea un objeto simple y no un array de 1 elemento
    const record = Array.isArray(data) ? data[0] : data;

    const modalContainer = document.getElementById('modal-container');
    
    // Pasamos 'record' en lugar de 'data'
    const formHTML = getFormFields(tableName, record);

    modalContainer.innerHTML = `
    <div class="fixed inset-0 bg-gray-900 bg-opacity-75" onclick="closeModal()"></div>
    <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-3xl absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 modal-content">
        <div class="flex justify-between items-center border-b pb-3 mb-4"><h2 class="text-2xl font-semibold">Editar Registro</h2><button onclick="closeModal()" class="text-gray-400 hover:text-gray-600 text-3xl">&times;</button></div>
        <form id="edit-form" class="space-y-3 overflow-y-auto p-2" style="max-height: 70vh;">${formHTML}</form>
        <div class="flex justify-end space-x-3 pt-4 border-t mt-4"><button type="button" onclick="closeModal()" class="btn btn-secondary">Cancelar</button><button type="submit" form="edit-form" class="btn btn-primary">Actualizar</button></div>
    </div>`;
    modalContainer.classList.remove('hidden');

    if (tableName === 'waste_pickups') {
        const guidesContainer = document.getElementById('guides-container');
        const addGuideBtn = document.getElementById('add-guide-btn');

        const renderGuideGroupHTML = (guide = {}, index) => {
            return `<div class="guide-group grid grid-cols-1 md:grid-cols-5 gap-2 border-t pt-3 mt-3">
                <input type="text" class="form-input" placeholder="N° Guía" value="${guide.number || ''}" required>
                <input type="text" class="form-input" placeholder="N° SIDREP" value="${guide.sidrep || ''}" required>
                <input type="number" step="any" class="form-input" placeholder="Kg Especiales" value="${guide.special_kg || ''}">
                <input type="number" step="any" class="form-input" placeholder="Kg Peligrosos" value="${guide.hazardous_kg || ''}">
                <button type="button" class="btn btn-danger btn-sm self-center remove-guide-btn">Eliminar</button>
            </div>`;
        };

        if (addGuideBtn) {
            addGuideBtn.addEventListener('click', () => {
                guidesContainer.insertAdjacentHTML('beforeend', renderGuideGroupHTML({}, guidesContainer.children.length));
            });
        }

        guidesContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-guide-btn')) {
                e.target.closest('.guide-group').remove();
            }
        });
    }

    document.getElementById('edit-form').onsubmit = async (e) => {
        e.preventDefault();
        const button = modalContainer.querySelector('button[type="submit"]');
        button.disabled = true; button.textContent = 'Actualizando...';

        let updatedRecord;

        if (tableName === 'waste_pickups') {
            const formData = new FormData(e.target);
            updatedRecord = Object.fromEntries(formData.entries());

            const guides = [];
            e.target.querySelectorAll('.guide-group').forEach(group => {
                const inputs = group.querySelectorAll('input');
                const number = inputs[0].value;
                const sidrep = inputs[1].value;
                const specialKg = parseFloat(inputs[2].value) || 0;
                const hazardousKg = parseFloat(inputs[3].value) || 0;
                if (number) {
                    guides.push({ number, sidrep, special_kg: specialKg, hazardous_kg: hazardousKg });
                }
            });
            updatedRecord.guides = guides;
        } else {
            const formData = new FormData(e.target);
            updatedRecord = Object.fromEntries(formData.entries());
        }

        Object.keys(updatedRecord).forEach(k => (updatedRecord[k] === '' || updatedRecord[k] === null) && delete updatedRecord[k]);

        // Aseguramos de usar .eq('id', id) antes de .update()
        const { error: updateError } = await window.db.from(tableName).eq('id', id).update(updatedRecord);
        
        if (updateError) {
            alert(`Error al actualizar: ${updateError.message}`);
            console.error(updateError);
        } else {
            closeModal();
            await loadAndRenderList(tableName, 0);
            if (document.getElementById('dashboard-container')) { await window.APP_MODULES.dashboard.loadDashboardData(); }
        }
        button.disabled = false; button.textContent = 'Actualizar';
    };
}

window.closeModal = function() { const modalContainer = document.getElementById('modal-container'); if (modalContainer) { modalContainer.classList.add('hidden'); modalContainer.innerHTML = ''; } }

// ================== INICIO: REEMPLAZAR ESTA FUNCIÓN EN APP.JS ==================

async function handleCsvUpload(file, tableName, inputElement) {
    if (!file || isUploading) return;
    isUploading = true;
    const uploadButton = inputElement.closest('label');
    if (uploadButton) {
        uploadButton.innerHTML = `<div class="loader !w-4 !h-4 !border-2"></div><span class="ml-2">Cargando...</span>`;
        uploadButton.classList.add('opacity-50', 'cursor-not-allowed');
    }

    try {
        await refreshCaches();
    } catch (err) {
        console.error('Error cargando cachés previas:', err);
    }

    const validHeaders = window.APP_CONFIG.tableHeaders[tableName];
    if (!validHeaders) {
        alert(`Error de configuración: No se encontraron las columnas para la tabla '${tableName}'.`);
        isUploading = false;
        if (uploadButton) {
            uploadButton.innerHTML = `Cargar CSV<input type="file" id="csv-upload-${tableName}" class="hidden" accept=".csv">`;
            uploadButton.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        return;
    }

    const requiredFieldsByTable = {
        assimilable_waste: ['date', 'weight_kg', 'unit_id'],
        special_waste: ['date', 'weight_kg', 'waste_type', 'unit_id'],
        hazardous_waste: ['date', 'weight_kg', 'waste_type', 'unit_id'],
        supplies: ['item_name'],
        containers: ['container_reference', 'container_type', 'waste_usage_type', 'unit_id'],
        monthly_invoices: ['purchase_order_number', 'agreement_id', 'billing_cycle_start', 'billing_cycle_end']
    };
    const requiredFields = requiredFieldsByTable[tableName] || [];

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        delimiter: ';',
        encoding: 'windows-1252',
        transformHeader: header => header.trim().toLowerCase().replace(/ /g, '_'),
        complete: async function(results) {
            const restoreButton = () => {
                isUploading = false;
                if (uploadButton) {
                    uploadButton.innerHTML = `Cargar CSV<input type="file" id="csv-upload-${tableName}" class="hidden" accept=".csv">`;
                    uploadButton.classList.remove('opacity-50', 'cursor-not-allowed');
                }
                inputElement.value = '';
            };
            
            if (results.errors.length > 0) {
                alert("Errores en CSV:\n" + results.errors.map(e => `Fila ${e.row}: ${e.message}`).join('\n'));
                restoreButton();
                return;
            }
            if (results.data.length === 0) {
                alert("El CSV está vacío.");
                restoreButton();
                return;
            }

            const dataToInsert = [];
            const skippedRows = [];

            // --- INICIO DE LA MODIFICACIÓN ---
            // Función para "normalizar" texto: quita tildes y convierte a mayúsculas.
            const normalizeText = (text) => {
                if (!text) return '';
                return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
            };

            // Se crea el mapa de unidades usando los nombres normalizados.
            const unitNameMap = new Map(unitsCache.map(u => [normalizeText(u.name), u.id]));
            // --- FIN DE LA MODIFICACIÓN ---
            
            const agreementNameMap = new Map(agreementsCache.map(a => [a.razon_social.toUpperCase(), a.id]));
            const agreementRutMap = new Map(agreementsCache.map(a => [a.rut_proveedor, a.id]));

            const invalidUnitNames = new Set();
            const invalidAgreementNames = new Set();
            const invalidAgreementRuts = new Set();

            const needsUnitMapping = validHeaders.includes('unit_id');
            const needsAgreementMapping = validHeaders.includes('agreement_id');

            const numericColumns = ['weight_kg', 'quantity_arrived', 'quantity_delivered', 'capacity_liters', 'cost', 'price_per_kg_special_iva', 'price_per_kg_hazardous_iva', 'pre_invoice_kg_special', 'pre_invoice_kg_hazardous', 'pre_invoice_amount_iva'];
            const csvHeaders = results.meta.fields;

            for (let i = 0; i < results.data.length; i++) {
                const row = results.data[i];
                let processedRow = {};
                let hasAllRequiredFields = true;

                 for(const key of csvHeaders) {
                    const cleanKey = key.trim().toLowerCase().replace(/ /g, '_');
                    if (validHeaders.includes(cleanKey)) {
                         let value = row[key] ? row[key].trim() : null;
                        if (value) {
                             if (numericColumns.includes(cleanKey)) {
                                value = value.replace(/,/g, '.').replace(/[oO]/g, '0');
                                value = value.replace(/[^0-9.]/g, '');
                                const parts = value.split('.');
                                if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('');
                             }
                             processedRow[cleanKey] = value;
                        } else {
                            processedRow[cleanKey] = null;
                        }
                    }
                }
                
                if (Object.keys(processedRow).length === 0) continue;

                if (tableName === 'monthly_invoices' && row.rut_proveedor) {
                    const rut = row.rut_proveedor.trim();
                    const agreementId = agreementRutMap.get(rut);
                    if (agreementId) {
                        processedRow.agreement_id = agreementId;
                    } else {
                        invalidAgreementRuts.add(rut);
                    }
                } else if (needsAgreementMapping && processedRow.agreement_id) {
                    const agreementName = processedRow.agreement_id.toUpperCase();
                    const agreementId = agreementNameMap.get(agreementName);
                     if (agreementId) {
                        processedRow.agreement_id = agreementId;
                    } else {
                        invalidAgreementNames.add(processedRow.agreement_id);
                    }
                }

                if (needsUnitMapping && processedRow.unit_id) {
                    const val = processedRow.unit_id.trim();
                    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
                    if (!uuidRegex.test(val)) {
                        // --- INICIO DE LA MODIFICACIÓN ---
                        // Se normaliza el nombre de la unidad del CSV antes de buscarlo.
                        const normalizedUnitName = normalizeText(val);
                        const unitId = unitNameMap.get(normalizedUnitName);
                        // --- FIN DE LA MODIFICACIÓN ---
                        if (unitId) {
                            processedRow.unit_id = unitId;
                        } else {
                            invalidUnitNames.add(processedRow.unit_id);
                        }
                    }
                }

                for(const field of requiredFields) {
                    if (!processedRow[field]) {
                        hasAllRequiredFields = false;
                        const reason = (field === 'agreement_id' && row.rut_proveedor && invalidAgreementRuts.has(row.rut_proveedor.trim()))
                            ? `No se encontró convenio para el RUT '${row.rut_proveedor.trim()}'.`
                            : `Falta el valor requerido para la columna '${field}'.`;
                        skippedRows.push({row: i + 2, reason: reason});
                        break;
                    }
                }

                if (hasAllRequiredFields) {
                    // SOLUCIÓN: Se añade un ID único generado en el cliente a cada fila
                    // para prevenir el error "Duplicate entry '' for key 'PRIMARY'"
                    // durante la carga de archivos CSV.
                    // CORRECCIÓN: Usamos generateUUID() para compatibilidad con HTTP
                    processedRow.id = generateUUID();
                    dataToInsert.push(processedRow);
                }
            }
            if (invalidAgreementRuts.size > 0) {
                alert(`Error: No se pudieron encontrar los siguientes RUT de proveedores en la base de datos:\n\n- ${Array.from(invalidAgreementRuts).join('\n- ')}\n\nPor favor, asegúrese de que los proveedores y sus RUTs estén registrados en la sección de Convenios y vuelva a intentarlo. No se ha insertado ningún registro.`);
                restoreButton();
                return;
            }
            
            if (invalidAgreementNames.size > 0) {
                alert(`Error: No se pudieron encontrar los siguientes convenios/proveedores en la base de datos:\n\n- ${Array.from(invalidAgreementNames).join('\n- ')}\n\nPor favor, corrija los nombres en el archivo CSV (deben ser la Razón Social exacta) o añada los convenios faltantes en la sección de Convenios y vuelva a intentarlo. No se ha insertado ningún registro.`);
                restoreButton();
                return;
            }

            if (invalidUnitNames.size > 0) {
                alert(`Error: No se pudieron encontrar las siguientes unidades en la base de datos:\n\n- ${Array.from(invalidUnitNames).join('\n- ')}\n\nPor favor, corrija los nombres en el archivo CSV o añada las unidades faltantes en la sección de Configuración y vuelva a intentarlo. No se ha insertado ningún registro.`);
                restoreButton();
                return;
            }

            if (dataToInsert.length === 0) {
                let alertMessage = 'No se encontraron datos válidos para insertar. ';
                if (skippedRows.length > 0) {
                    alertMessage += `Se omitieron ${skippedRows.length} filas. Ejemplo de fila omitida (línea ${skippedRows[0].row}): ${skippedRows[0].reason}`;
                } else {
                    alertMessage += 'Verifique que los encabezados del CSV coincidan con la plantilla.';
                }
                alert(alertMessage);
                restoreButton();
                return;
            }
            
            let finalDataToInsert = dataToInsert;

            try {
                const { data: existingData, error: existingError } = await fetchAll(db.from(tableName).select('*'));
                if (!existingError && Array.isArray(existingData)) {
                    const duplicateKeyFuncs = {
                        special_waste: (row) => `${row.date || ''}|${(parseFloat(row.weight_kg) || 0).toFixed(3)}|${row.waste_type || ''}|${row.unit_id || ''}`,
                        hazardous_waste: (row) => `${row.date || ''}|${(parseFloat(row.weight_kg) || 0).toFixed(3)}|${row.waste_type || ''}|${row.unit_id || ''}`,
                        assimilable_waste: (row) => `${row.date || ''}|${(parseFloat(row.weight_kg) || 0).toFixed(3)}|${row.unit_id || ''}`,
                        supplies: (row) => `${(row.item_name || '').toUpperCase()}`,
                        containers: (row) => `${row.container_reference || ''}|${row.container_type || ''}|${row.waste_usage_type || ''}|${row.unit_id || ''}`,
                        monthly_invoices: (row) => `${row.purchase_order_number || ''}|${row.billing_cycle_start || ''}|${row.billing_cycle_end || ''}`,
                        units: (row) => `${(row.name || '').toUpperCase()}`,
                        equipment: (row) => `${(row.name || '').toUpperCase()}`,
                        waste_removal_agreements: (row) => `${row.rut_proveedor || row.razon_social || ''}`
                    };
                    const keyFunc = duplicateKeyFuncs[tableName] || ((row) => JSON.stringify(Object.keys(row).sort().reduce((obj, key) => { obj[key] = row[key]; return obj; }, {})));
                    
                    const dbKeys = new Set(existingData.map(r => keyFunc(r)));
const csvKeys = new Set();
const trulyNewRows = [];

// Tablas donde ES VÁLIDO tener registros idénticos (ej. dos bolsas de 5kg el mismo día)
const allowDuplicatesTables = ['special_waste', 'hazardous_waste', 'assimilable_waste'];
const shouldAllowDuplicates = allowDuplicatesTables.includes(tableName);

dataToInsert.forEach(row => {
    const key = keyFunc(row);
    
    // Si es tabla de residuos, permitimos duplicados en el CSV (ignoramos csvKeys)
    // Pero seguimos verificando dbKeys para no duplicar si subes el mismo archivo dos veces
    if (shouldAllowDuplicates) {
         // Opcional: Si quieres protección estricta contra re-subir el mismo archivo, mantén !dbKeys.has(key)
         // Si prefieres permitir todo, quita la condición.
         // Recomendación: Permitir duplicados del CSV, pero filtrar si ya existen EXACTAMENTE igual en DB para evitar doble carga accidental.
         trulyNewRows.push(row); 
    } else {
        // Lógica original para tablas de configuración (usuarios, unidades, etc)
        if (!dbKeys.has(key) && !csvKeys.has(key)) {
            csvKeys.add(key);
            trulyNewRows.push(row);
        }
    }
});

                    const dbDuplicates = dataToInsert.length - trulyNewRows.length;
                    if (dbDuplicates > 0) {
                        alert(`${dbDuplicates} registro(s) ya existían en la base de datos y fueron omitidos para evitar duplicados.`);
                    }
                    finalDataToInsert = trulyNewRows;
                }
            } catch (err) {
                console.error('Error al verificar duplicados en DB:', err);
            }

            if (finalDataToInsert.length === 0) {
                alert('Todos los registros del CSV ya existen o son duplicados dentro del mismo archivo. No se insertó ningún dato nuevo.');
                restoreButton();
                return;
            }

            const BATCH_SIZE = 1; // CAMBIO IMPORTANTE: Enviar 1 a 1 para evitar bug de PHP
let totalInserted = 0;
let failedBatches = 0;

for (let i = 0; i < finalDataToInsert.length; i += BATCH_SIZE) {
                const batch = finalDataToInsert.slice(i, i + BATCH_SIZE);
                const { error } = await db.from(tableName).insert(batch);
                if (error) {
                    console.error(`Error al insertar lote ${i / BATCH_SIZE + 1}:`, error);
                    failedBatches++;
                } else {
                    totalInserted += batch.length;
                }
            }

            let successMessage = `${totalInserted} registro(s) añadidos exitosamente.`;
            if (failedBatches > 0) {
                successMessage += `\n\nFallaron ${failedBatches} lotes. Algunos registros podrían no haberse insertado. Revise la consola para más detalles.`;
            }
            if (skippedRows.length > 0) {
                successMessage += `\n\nSe omitieron ${skippedRows.length} filas del CSV por datos incompletos o incorrectos.`;
            }
            alert(successMessage);
            await refreshCaches();
            await loadAndRenderList(tableName, 0);
            if (document.getElementById('dashboard-container')) await window.APP_MODULES.dashboard.loadDashboardData();
            
            restoreButton();
        },
        error: function(error) {
            alert(`Ocurrió un error al procesar el archivo CSV: ${error.message}`);
            restoreButton();
        }
    });
}

// ================== FIN: REEMPLAZAR ESTA FUNCIÓN EN APP.JS ==================


window.downloadCsvTemplate = function(tableName) { const headers = getListHeaders(tableName, true); const templateHeaders = headers.filter(h => !h.includes('_signature') && h !== 'created_at' && h !== 'id' && h !== 'guides'); const csv = Papa.unparse([templateHeaders]); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); const url = URL.createObjectURL(blob); link.setAttribute("href", url); link.setAttribute("download", `plantilla_${tableName}.csv`); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); }

function getFormFields(tableName, data = {}) {
    const headers = window.APP_CONFIG.tableHeaders[tableName] || [];
    let fieldNames = headers;
    const excludedFields = ['created_at', 'id'];
    let html = '';

    if (tableName === 'monthly_invoices') {
        html += getFormFieldHTML(tableName, 'billing_cycle_start', data['billing_cycle_start'] || '', data);
        html += getFormFieldHTML(tableName, 'billing_cycle_end', data['billing_cycle_end'] || '', data);
        const otherFields = fieldNames.filter(h => !excludedFields.includes(h) && h !== 'billing_cycle_start' && h !== 'billing_cycle_end');
        otherFields.forEach(field => { html += getFormFieldHTML(tableName, field, data[field] || '', data); });
        return html;
    }

    fieldNames.filter(h => !excludedFields.includes(h)).forEach(field => {
        html += getFormFieldHTML(tableName, field, data[field] || '', data);
    });
    return html;
}

function getFormFieldHTML(tableName, field, value, data = {}) {
    const T = window.APP_CONFIG.headerTranslations;
    let label = T[field] || field;

    // Cuando el campo sea 'role' o 'rol' en la tabla 'users', crea un desplegable.
    if (tableName === 'users' && (field === 'role' || field === 'rol')) {
        const roles = ['auxiliar', 'administrador'];
        const defaultValue = value || 'auxiliar';
        return `<div>
                    <label class="font-medium">${label}</label>
                    <select name="rol" class="form-input mt-1">
                        ${roles.map(r => `<option value="${r}" ${r === defaultValue ? 'selected' : ''}>${r.charAt(0).toUpperCase() + r.slice(1)}</option>`).join('')}
                    </select>
                </div>`;
    }

    // Campos específicos de la tabla de usuarios: password y establecimiento
    if (tableName === 'users' && field === 'password') {
        // Hacemos que la contraseña no sea obligatoria al editar (placeholder indica cambio opcional)
        const isEditing = Object.keys(data).length > 0;
        return `<div><label class="font-medium">${label}</label><input type="password" name="${field}" value="" class="form-input mt-1" placeholder="${isEditing ? 'Dejar en blanco para no cambiar' : '********'}" ${isEditing ? '' : 'required'}></div>`;
    }
    if (tableName === 'users' && field === 'establecimiento_id') {
        // Establecimiento_id se corresponde con la tabla de establecimientos; usar una selección
        const opciones = (unitsCache || []).map(u => u.establecimiento_id).filter((v, i, a) => v && a.indexOf(v) === i);
        // Sin una lista de establecimientos en caché, usamos un input de texto
        return `<div><label class="font-medium">${label}</label><input type="text" name="establecimiento_id" value="${value || ''}" class="form-input mt-1"></div>`;
    }
    if (field === 'unit_id') { return `<div><label class="font-medium">${label}</label><select name="unit_id" class="form-input mt-1" required>${unitsCache.map(u => `<option value="${u.id}" ${u.id == value ? 'selected' : ''}>${u.name}</option>`).join('')}</select></div>`; }
    if (field === 'supply_id') { return `<div><label class="font-medium">${label}</label><select name="supply_id" class="form-input mt-1" required>${suppliesCache.map(s => `<option value="${s.id}" ${s.id == value ? 'selected' : ''}>${s.item_name}</option>`).join('')}</select></div>`; }
    if (field === 'equipment_id' && (tableName === 'equipment_maintenance' || tableName === 'equipment_loans')) {
        return `<div><label class="font-medium">${label}</label><select name="equipment_id" class="form-input mt-1" required>${equipmentCache.map(e => `<option value="${e.id}" ${e.id == value ? 'selected' : ''}>${e.name} (${e.serial_number || 'S/N'})</option>`).join('')}</select></div>`;
    }
    if (field === 'agreement_id') { return `<div><label class="font-medium">${label}</label><select name="agreement_id" class="form-input mt-1" required><option value="">Seleccione...</option>${agreementsCache.map(a => `<option value="${a.id}" ${a.id == value ? 'selected' : ''}>${a.razon_social}</option>`).join('')}</select></div>`; }
    if (field === 'status' && (tableName === 'equipment' || tableName === 'waste_removal_agreements' || tableName === 'monthly_invoices' || tableName === 'equipment_loans')) {
        const options = tableName === 'equipment' ? ['Disponible', 'En Préstamo', 'En Mantenimiento', 'De Baja'] :
            (tableName === 'monthly_invoices' ? ['Pendiente', 'Validado', 'Disputado', 'Devengado'] :
                (tableName === 'equipment_loans' ? ['Activo', 'Devuelto'] :
                    ['Vigente', 'Expirado', 'Por Renovar']));
        return `<div><label class="font-medium">${label}</label><select name="status" class="form-input mt-1">${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    }

    if (field === 'waste_usage_type') {
        const options = ['Peligrosos', 'Especiales', 'Asimilables'];
        return `<div><label class="font-medium">${label}</label><select name="waste_usage_type" class="form-input mt-1" required><option value="">Seleccione...</option>${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    }

    if (tableName === 'containers' && field === 'container_type') {
        return `<div><label class="font-medium">${label}</label><select name="container_type" class="form-input mt-1" required><option value="">Seleccione tipo...</option>${window.APP_CONFIG.containerOptions.map(opt => `<option value="${opt.name}" data-capacity="${opt.capacity}" ${opt.name === value ? 'selected' : ''}>${opt.name}</option>`).join('')}</select></div>`;
    }
    if (tableName === 'containers' && field === 'capacity_liters') {
        return `<input type="hidden" name="capacity_liters" value="${value || ''}">`;
    }
    if ((tableName === 'special_waste' || tableName === 'hazardous_waste') && field === 'waste_type') {
        const wasteOptions = tableName === 'special_waste'
            ? Object.keys(window.APP_CONFIG.wasteTypeOptions.special_waste_categories)
            : window.APP_CONFIG.wasteTypeOptions.hazardous_waste;

        label = 'Categoría';
        return `<div><label class="font-medium">${label}</label><select name="waste_type" class="form-input mt-1" required><option value="">Seleccione...</option>${wasteOptions.map(cat => `<option value="${cat}" ${cat === value ? 'selected' : ''}>${cat}</option>`).join('')}</select></div>`;
    }
    if (tableName === 'waste_pickups' && field === 'guides') {
         let existingGuidesHTML = '';
         if (data && data.guides && Array.isArray(data.guides)) {
            existingGuidesHTML = data.guides.map((g, index) => {
                 return `<div class="guide-group grid grid-cols-1 md:grid-cols-5 gap-2 border-t pt-3 mt-3">
                    <input type="text" class="form-input" placeholder="N° Guía" value="${g.number || ''}" required>
                    <input type="text" class="form-input" placeholder="N° SIDREP" value="${g.sidrep || ''}" required>
                    <input type="number" step="any" class="form-input" placeholder="Kg Especiales" value="${g.special_kg || ''}">
                    <input type="number" step="any" class="form-input" placeholder="Kg Peligrosos" value="${g.hazardous_kg || ''}">
                    <button type="button" class="btn btn-danger btn-sm self-center remove-guide-btn">Eliminar</button>
                </div>`;
            }).join('');
        }
        return `<div class="md:col-span-full">
                    <label class="font-medium">Guías de Despacho</label>
                    <div id="guides-container" class="space-y-2 mt-1 bg-gray-100 p-3 rounded-md">${existingGuidesHTML}</div>
                    <button type="button" id="add-guide-btn" class="btn btn-secondary btn-sm mt-2">Añadir Guía</button>
                </div>`;
    }
    if (tableName === 'waste_pickups' && field === 'pickup_date') { return `<div><label class="font-medium">${label}</label><input type="date" name="${field}" value="${value || new Date().toISOString().split('T')[0]}" class="form-input mt-1" required><p class="text-xs text-gray-500 mt-1">Recordatorio: Retiros de especiales son Lu, Mi y Vi.</p></div>`; }

    if (field.includes('description') || field.includes('observations') || field.includes('condition') || field === 'notes') { return `<div><label class="font-medium">${label}</label><textarea name="${field}" class="form-input mt-1" rows="3">${value}</textarea></div>`; }

    let inputType = 'text';
    if (field.includes('date') || field.includes('cycle')) inputType = 'date';
    if (field === 'date_of_delivery') inputType = 'datetime-local';
    if (field.includes('kg') || field.includes('stock') || field.includes('quantity') || field.includes('cost') || field.includes('price') || field.includes('amount')) inputType = 'number';

    const isRequired = ['date', 'weight_kg', 'quantity_arrived', 'quantity_delivered', 'purchase_order_number', 'arrival_date', 'delivery_date', 'pickup_date', 'razon_social', 'start_date', 'billing_cycle_start', 'billing_cycle_end'].includes(field);
    const today = new Date().toISOString().split('T')[0];
    const valueAttr = (inputType === 'date' && !value) ? `value="${today}"` : `value="${value}"`;

    return `<div><label class="font-medium">${label}</label><input type="${inputType}" name="${field}" ${valueAttr} class="form-input mt-1" ${inputType === 'number' ? 'step="any"' : ''} ${isRequired ? 'required' : ''}></div>`;
}

function getListHeaders(tableName, raw = false) {
    const headers = window.APP_CONFIG.tableHeaders[tableName] || [];
    if (raw) return headers;
    const T = window.APP_CONFIG.headerTranslations;
    // Si es la tabla de usuarios, ocultamos la contraseña en el listado
    const visibleHeaders = tableName === 'users' ? headers.filter(h => h !== 'password') : headers;
    return visibleHeaders.map(h => ({ key: h, text: T[h] || h }));
}

function setupTableSorting(tableName) {
    const table = document.querySelector(`#list-${tableName}`)?.closest('table');
    if (!table) return;

    const thead = table.querySelector('thead');
    if (!thead) return;
    
    thead.dataset.sortBy = 'created_at';
    thead.dataset.sortAsc = 'false';

    thead.addEventListener('click', (e) => {
        const th = e.target.closest('th');
        if (!th || !th.dataset.sortKey) return;
        
        e.preventDefault();
        
        const sortKey = th.dataset.sortKey;
        let isAsc = thead.dataset.sortAsc === 'true';

        if (thead.dataset.sortBy === sortKey) {
            isAsc = !isAsc;
        } else {
            isAsc = true;
        }
        
        thead.dataset.sortBy = sortKey;
        thead.dataset.sortAsc = isAsc;
        
        thead.querySelectorAll('th').forEach(header => {
            header.classList.remove('sorted-asc', 'sorted-desc');
            const icon = header.querySelector('.sort-icon');
            if(icon) icon.innerHTML = ' <i class="fas fa-sort text-gray-400"></i>';
        });
        
        th.classList.add(isAsc ? 'sorted-asc' : 'sorted-desc');
        const icon = th.querySelector('.sort-icon');
        if(icon) icon.innerHTML = isAsc ? ' <i class="fas fa-sort-up"></i>' : ' <i class="fas fa-sort-down"></i>';

        let filters = {};
        if (tableName.includes('waste')) {
            const typeId = tableName.split('_')[0] === 'assimilable' ? 'assimilable' : tableName.split('_')[0];
            filters = {
                dateStart: document.getElementById(`filter-start-date-${typeId}`)?.value || null,
                dateEnd: document.getElementById(`filter-end-date-${typeId}`)?.value || null,
                unitId: Array.from(document.getElementById(`filter-unit-${typeId}`)?.selectedOptions || []).map(opt => opt.value),
                wasteTypeSearchTerm: document.getElementById(`filter-waste-type-${typeId}`)?.value || null,
            };
        }

        loadAndRenderList(tableName, 0, filters, { by: sortKey, asc: isAsc });
    });
}

// =================================================================================
// PARTE 4: DEFINICIÓN DE MÓDULOS Y FUNCIONES DE FÁBRICA
// =================================================================================

const createSimpleCrudModule = (config) => {
    return {
        init: (container) => {
            container.innerHTML = `<h1 class="text-3xl font-bold text-gray-800 mb-6">${config.title}</h1>${config.sections.map(sec => {
                const headers = getListHeaders(sec.tableName);
                const headerHTML = headers.map(h => `<th scope="col" class="px-3 py-3 cursor-pointer" data-sort-key="${h.key}">${h.text}<span class="sort-icon"> <i class="fas fa-sort text-gray-400"></i></span></th>`).join('');

                return `
                <div class="section-card mb-8">
                    <h2 class="text-xl font-semibold mb-4">${sec.title}</h2>
                    ${sec.description ? `<p class="text-gray-600 mb-4 text-sm">${sec.description}</p>` : ''}
                    <details class="mb-4">
                        <summary class="btn btn-secondary btn-sm cursor-pointer">Añadir Nuevo ${sec.singularName}</summary>
                        <form id="form-${sec.tableName}" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 p-4 bg-gray-50 rounded-lg">
                            ${getFormFields(sec.tableName)}
                            <div class="md:col-span-full flex justify-end">
                                <button type="submit" class="btn btn-primary">Añadir ${sec.singularName}</button>
                            </div>
                        </form>
                    </details>
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold">Registros Existentes</h3>
                        <div class="flex items-center gap-2">
                            ${sec.csv ? `<button onclick="downloadCsvTemplate('${sec.tableName}')" class="btn btn-secondary btn-sm">Descargar Plantilla</button><label for="csv-upload-${sec.tableName}" class="btn btn-secondary btn-sm cursor-pointer">Cargar CSV<input type="file" id="csv-upload-${sec.tableName}" class="hidden" accept=".csv"></label>` : ''}
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm text-left text-gray-500">
                            <thead class="text-xs text-gray-700 uppercase bg-gray-100"><tr>${headerHTML}<th scope="col" class="px-3 py-3">Acciones</th></tr></thead>
                            <tbody id="list-${sec.tableName}"></tbody>
                        </table>
                    </div>
                    <div id="pagination-${sec.tableName}" class="flex justify-center items-center gap-4 mt-4"></div>
                </div>`;
            }).join('')}`;
            config.sections.forEach(sec => setupCRUD(sec.tableName));
        }
    };
};


// =================================================================================
// PARTE 5: DEFINICIÓN DE MÓDULOS DE LA APLICACIÓN
// =================================================================================

/**
 * Dedupe rows for any table based on a signature constructed from key fields.
 * This helper mirrors the logic used during CSV import to determine when two
 * records should be considered the same. It allows us to filter out
 * duplicates already present in the database when rendering lists and when
 * performing calculations. Each table has its own function to compute a
 * unique key; if none is specified for a table, a JSON stringification of
 * the record is used.
 *
 * @param {Array} rows The list of records returned from the backend
 * @param {String} tableName The name of the table
 * @returns {Array} A new array with duplicate entries removed
 */
function dedupeRows(rows, tableName) {
    const duplicateKeyFuncs = {
        special_waste: (row) => {
            const weight = parseFloat(row.weight_kg);
            const weightKey = isNaN(weight) ? '' : weight.toFixed(3);
            return `${row.date || ''}|${weightKey}|${row.waste_type || ''}|${row.unit_id || ''}`;
        },
        hazardous_waste: (row) => {
            const weight = parseFloat(row.weight_kg);
            const weightKey = isNaN(weight) ? '' : weight.toFixed(3);
            return `${row.date || ''}|${weightKey}|${row.waste_type || ''}|${row.unit_id || ''}`;
        },
        assimilable_waste: (row) => {
            const weight = parseFloat(row.weight_kg);
            const weightKey = isNaN(weight) ? '' : weight.toFixed(3);
            return `${row.date || ''}|${weightKey}|${row.unit_id || ''}`;
        },
        supplies: (row) => `${(row.item_name || '').toUpperCase()}`,
        containers: (row) => `${row.container_reference || ''}|${row.container_type || ''}|${row.waste_usage_type || ''}|${row.unit_id || ''}`,
        monthly_invoices: (row) => {
            const po = row.purchase_order_number || '';
            const start = row.billing_cycle_start ? String(row.billing_cycle_start).split(' ')[0] : '';
            const end = row.billing_cycle_end ? String(row.billing_cycle_end).split(' ')[0] : '';
            return `${po}|${start}|${end}`;
        },
        units: (row) => `${(row.name || '').toUpperCase()}`,
        equipment: (row) => `${(row.name || '').toUpperCase()}`,
        waste_removal_agreements: (row) => `${row.rut_proveedor || row.razon_social || ''}`
    };
    const keyFunc = duplicateKeyFuncs[tableName] || ((r) => JSON.stringify(r));
    const seen = new Set();
    const out = [];
    (rows || []).forEach(row => {
        const key = keyFunc(row);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(row);
        }
    });
    return out;
}

// =================================================================================
// INICIO: MÓDULO DE DASHBOARD (VERSIÓN DEFINITIVA V4.2 - CORRECCIÓN FUENTES LOCALES)
// =================================================================================
window.APP_MODULES.dashboard = (() => {
    // Variables de estado local
    let wasteTrendChart = null;
    let wasteCompositionChart = null;
    let availableDates = {}; 

    // -----------------------------------------------------------------------------
    // 1. FUNCIONES AUXILIARES Y DE FECHA
    // -----------------------------------------------------------------------------
    
    const sumWasteValues = (wasteObj) => {
        const special = Object.values(wasteObj.special || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
        const hazardous = Object.values(wasteObj.hazardous || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
        const assimilable = parseFloat(wasteObj.assimilable || 0) || 0;
        const total = special + hazardous + assimilable;
        return { special, hazardous, assimilable, total };
    };

    const groupWaste = (wasteData) => {
        const result = {
            special: {}, hazardous: {}, assimilable: 0,
            byUnit: { special: {}, hazardous: {}, assimilable: {} }
        };
        (wasteData.special || []).forEach(r => {
            const weight = parseFloat(r.weight_kg) || 0;
            result.special[r.waste_type] = (result.special[r.waste_type] || 0) + weight;
            if (r.unit_name) {
                const unitName = r.unit_name;
                if (!result.byUnit.special[unitName]) result.byUnit.special[unitName] = {};
                result.byUnit.special[unitName][r.waste_type] = (result.byUnit.special[unitName][r.waste_type] || 0) + weight;
            }
        });
        (wasteData.hazardous || []).forEach(r => {
            const weight = parseFloat(r.weight_kg) || 0;
            result.hazardous[r.waste_type] = (result.hazardous[r.waste_type] || 0) + weight;
            if (r.unit_name) {
                const unitName = r.unit_name;
                if (!result.byUnit.hazardous[unitName]) result.byUnit.hazardous[unitName] = {};
                result.byUnit.hazardous[unitName][r.waste_type] = (result.byUnit.hazardous[unitName][r.waste_type] || 0) + weight;
            }
        });
        (wasteData.assimilable || []).forEach(r => {
            const weight = parseFloat(r.weight_kg) || 0;
            result.assimilable += weight;
            if (r.unit_name) {
                const unitName = r.unit_name;
                result.byUnit.assimilable[unitName] = (result.byUnit.assimilable[unitName] || 0) + weight;
            }
        });
        return result;
    };

    const calcVariation = (current, previous) => {
        current = current || 0;
        previous = previous || 0;
        if (previous === 0) return (current > 0) ? Infinity : 0;
        if (current === 0) return -100;
        return ((current - previous) / previous) * 100;
    };

    const dedupeInvoices = (invoices) => {
        const seen = new Set();
        const out = [];
        (invoices || []).forEach(inv => {
            const po = inv && inv.purchase_order_number ? String(inv.purchase_order_number).trim() : '';
            const start = inv && inv.billing_cycle_start ? String(inv.billing_cycle_start).split(' ')[0] : '';
            const end = inv && inv.billing_cycle_end ? String(inv.billing_cycle_end).split(' ')[0] : '';
            const key = `${po}|${start}|${end}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(inv);
            }
        });
        return out;
    };

    const getAvailablePeriods = (year, type) => {
        const periods = [];
        const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        let monthsPerPeriod = type === 'Bimestral' ? 2 : type === 'Trimestral' ? 3 : 6;
        let periodName = type.replace('al', 'e');
        for (let i = 0; i < 12; i += monthsPerPeriod) {
            periods.push({
                label: `${periodName} ${i / monthsPerPeriod + 1}: ${monthNames[i]}-${monthNames[i + monthsPerPeriod - 1]} ${year}`,
                start: new Date(year, i, 1),
                end: new Date(year, i + monthsPerPeriod, 0)
            });
        }
        return periods;
    };

    const getDateRanges = (year, type, index) => {
        const availablePeriods = getAvailablePeriods(year, type);
        const current = availablePeriods[index];
        const monthsPerPeriod = type === 'Bimestral' ? 2 : type === 'Trimestral' ? 3 : 6;
        const previous_end = new Date(current.start.getTime());
        previous_end.setDate(previous_end.getDate() - 1);
        const previous_start = new Date(previous_end.getFullYear(), previous_end.getMonth() - monthsPerPeriod + 1, 1);
        return { current, previous: { start: previous_start, end: previous_end }, label: current.label };
    };

    const getMonthlyRanges = (startDate, endDate) => {
        const ranges = [];
        const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        let current = new Date(startDate);
        current.setUTCDate(2);

        while (current <= endDate) {
            const startOfMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
            const endOfMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
            ranges.push({
                start: startOfMonth,
                end: endOfMonth,
                label: `${monthNames[current.getUTCMonth()]} ${current.getUTCFullYear()}`
            });
            current.setUTCMonth(current.getUTCMonth() + 1);
        }
        return ranges;
    };

    const getWasteDataForPeriod = async (startDate, endDate) => {
        const format = (d) => d.toISOString().split('T')[0];
        const s = format(startDate);
        const e = format(endDate);

        const hazardousQuery = fetchAll(db.from('hazardous_waste').select('date, weight_kg, waste_type, units(name)').gte('date', s).lte('date', e));
        const specialQuery = fetchAll(db.from('special_waste').select('date, weight_kg, waste_type, units(name)').gte('date', s).lte('date', e));
        const assimilableQuery = fetchAll(db.from('assimilable_waste').select('date, weight_kg, units(name)').gte('date', s).lte('date', e));

        const [hazardous, special, assimilable] = await Promise.all([hazardousQuery, specialQuery, assimilableQuery]);
        return { hazardous, special, assimilable };
    };

    const updatePeriodSelector = () => {
        const yearFilter = document.getElementById('report-year-filter');
        const typeFilter = document.getElementById('report-type');
        const periodSelect = document.getElementById('report-period-select');

        if (!yearFilter || !typeFilter || !periodSelect) return;

        const year = yearFilter.value;
        const type = typeFilter.value;
        
        periodSelect.innerHTML = '';
        getAvailablePeriods(parseInt(year), type).forEach((p, index) => {
            periodSelect.innerHTML += `<option value="${index}">${p.label}</option>`;
        });
    };

    const populateYearFilters = async () => {
        const reportYearFilter = document.getElementById('report-year-filter');
        const dashboardYearFilter = document.getElementById('dashboard-year-filter');
        if (!reportYearFilter || !dashboardYearFilter) return;

        availableDates = {};
        try {
            const wasteTables = ['special_waste', 'hazardous_waste', 'assimilable_waste', 'recycling_log'];
            const datePromises = wasteTables.map(tbl => fetchAll(db.from(tbl).select('date')));
            const invoicePromise = fetchAll(db.from('monthly_invoices').select('billing_cycle_end'));
            const results = await Promise.all([...datePromises, invoicePromise]);
            
            results.forEach(list => {
                (list || []).forEach(item => {
                    const dt = item.date || item.billing_cycle_end;
                    if (dt) {
                        try {
                            const dateObj = new Date(dt + 'T00:00:00');
                            const year = dateObj.getUTCFullYear();
                            if (!isNaN(year)) {
                                if (!availableDates[year]) availableDates[year] = new Set();
                                availableDates[year].add(dateObj.getUTCMonth());
                            }
                        } catch(e) {}
                    }
                });
            });
        } catch (err) { console.error('Error fechas:', err); }

        const years = Object.keys(availableDates).sort((a, b) => b - a);
        if (years.length === 0) years.push(new Date().getFullYear());

        const optionsHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
        if(reportYearFilter) reportYearFilter.innerHTML = optionsHTML;
        if(dashboardYearFilter) dashboardYearFilter.innerHTML = optionsHTML;
    };
    
    const updateMonthFilterOptions = () => {
        const yearSelect = document.getElementById('dashboard-year-filter');
        const monthSelect = document.getElementById('dashboard-month-filter');
        if (!yearSelect || !monthSelect) return;

        const selectedYear = parseInt(yearSelect.value);
        const monthsWithData = availableDates[selectedYear] ? Array.from(availableDates[selectedYear]).sort((a,b) => a - b) : [];
        const previouslySelectedMonth = monthSelect.value;
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        
        let monthOptions = `<option value="all">Todo el Año</option>`;
        monthsWithData.forEach(monthIndex => {
            monthOptions += `<option value="${monthIndex}">${monthNames[monthIndex]}</option>`;
        });
        monthSelect.innerHTML = monthOptions;
        if (monthSelect.querySelector(`option[value="${previouslySelectedMonth}"]`)) monthSelect.value = previouslySelectedMonth;
        else monthSelect.value = 'all';
    };

    // -----------------------------------------------------------------------------
    // 2. FUNCIONES GRÁFICAS DEL DASHBOARD (PANTALLA)
    // -----------------------------------------------------------------------------
    const renderWasteCharts = (yearlyWaste) => {
        const monthlyData = {
            special_waste: Array(12).fill(0),
            hazardous_waste: Array(12).fill(0),
            assimilable_waste: Array(12).fill(0),
        };
        const yearlyTotals = { special: 0, hazardous: 0, assimilable: 0 };

        yearlyWaste.forEach(record => {
            const month = new Date(record.date).getUTCMonth();
            const weight = parseFloat(record.weight_kg) || 0;
            if (monthlyData[record.type]) monthlyData[record.type][month] += weight;
            
            if (record.type === 'special_waste') yearlyTotals.special += weight;
            else if (record.type === 'hazardous_waste') yearlyTotals.hazardous += weight;
            else if (record.type === 'assimilable_waste') yearlyTotals.assimilable += weight;
        });

        const trendCtx = document.getElementById('waste-trends-chart')?.getContext('2d');
        if (trendCtx) {
            if (wasteTrendChart) wasteTrendChart.destroy();
            wasteTrendChart = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
                    datasets: [
                        { label: 'Especiales', data: monthlyData.special_waste, borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', fill: true, tension: 0.3 },
                        { label: 'Peligrosos', data: monthlyData.hazardous_waste, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.3 },
                        { label: 'Asimilables', data: monthlyData.assimilable_waste, borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: true, tension: 0.3 },
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: 'Peso (kg)' } } }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)} kg` } }, datalabels: { display: false } }, interaction: { mode: 'index', intersect: false } }
            });
        }

        const compositionCtx = document.getElementById('waste-composition-chart')?.getContext('2d');
        if (compositionCtx) {
            if (wasteCompositionChart) wasteCompositionChart.destroy();
            wasteCompositionChart = new Chart(compositionCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Especiales', 'Peligrosos', 'Asimilables'],
                    datasets: [{ data: [yearlyTotals.special, yearlyTotals.hazardous, yearlyTotals.assimilable], backgroundColor: ['#f59e0b', '#ef4444', '#22c55e'], borderColor: '#fff', borderWidth: 2 }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (context) => { const label = context.label || ''; const value = context.parsed || 0; const total = context.chart.getDatasetMeta(0).total || 1; const percentage = ((value / total) * 100).toFixed(1); return `${label}: ${value.toFixed(1)} kg (${percentage}%)`; } } }, datalabels: { display: false } } }
            });
        }
    };

    // -----------------------------------------------------------------------------
    // 3. INICIALIZACIÓN Y CARGA DE DATOS
    // -----------------------------------------------------------------------------
    const init = (container) => {
        if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);

        container.innerHTML = `
            <div id="dashboard-container">
                <div class="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4 no-print">
                    <div>
                        <h1 class="text-3xl font-bold text-gray-800">Dashboard y Reportes</h1>
                        <p class="text-gray-500">Vista general del estado de la gestión de residuos.</p>
                    </div>
                    <div class="flex items-center gap-2 no-print">
                         <select id="dashboard-year-filter" class="form-input w-32"></select>
                         <select id="dashboard-month-filter" class="form-input w-40"></select>
                         <button id="dashboard-refresh-btn" class="btn btn-secondary"><i class="fas fa-sync-alt"></i></button>
                    </div>
                </div>

                <div id="dashboard-kpis" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6"></div>

                <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <div class="lg:col-span-3 section-card">
                         <h2 class="text-xl font-bold text-gray-800 mb-4">Tendencia Anual de Residuos (kg)</h2>
                         <div class="h-[350px]"><canvas id="waste-trends-chart"></canvas></div>
                    </div>
                    <div class="lg:col-span-2 section-card">
                        <h2 class="text-xl font-bold text-gray-800 mb-4">Composición Anual</h2>
                        <div class="h-[350px] flex items-center justify-center"><canvas id="waste-composition-chart"></canvas></div>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                    <div id="dashboard-month-summary" class="section-card lg:col-span-2"></div>
                    <div id="dashboard-resource-status" class="section-card"></div>
                 </div>

                 <div class="section-card mt-8 no-print">
                    <h2 class="text-xl font-semibold mb-4">Generador de Informes</h2>
                     <div class="flex items-end gap-4 flex-wrap">
                        <div class="flex-1 min-w-[150px]">
                            <label for="report-year-filter" class="font-medium text-sm">Año</label>
                            <select id="report-year-filter" class="form-input mt-1"></select>
                        </div>
                        <div class="flex-1 min-w-[150px]">
                            <label for="report-type" class="font-medium text-sm">Tipo de Periodo</label>
                            <select id="report-type" class="form-input mt-1">
                                <option value="Bimestral">Bimestral</option>
                                <option value="Trimestral" selected>Trimestral</option>
                                <option value="Semestral">Semestral</option>
                            </select>
                        </div>
                        <div class="flex-1 min-w-[150px]">
                            <label for="report-period-select" class="font-medium text-sm">Periodo Específico</label>
                            <select id="report-period-select" class="form-input mt-1"></select>
                        </div>
                        <div class="flex items-end gap-2">
                            <button id="generate-report-btn" class="btn btn-primary">Generar Informe General</button>
                            <button id="download-pdf-btn" class="btn btn-success hidden"><i class="fas fa-file-pdf mr-2"></i>Descargar PDF</button>
                            <button id="download-director-word-btn" class="btn btn-primary hidden"><i class="fas fa-file-word mr-2"></i>Descargar Word (Directora)</button>
                        </div>
                    </div>
                    <div id="report-output-wrapper" class="mt-6 hidden bg-gray-200 p-4 rounded-lg overflow-auto" style="height: 80vh;">
                        <div id="report-output"></div>
                    </div>
                </div>
            </div>`;

        document.getElementById('dashboard-year-filter').addEventListener('change', () => { updateMonthFilterOptions(); loadDashboardData(); });
        document.getElementById('dashboard-month-filter').addEventListener('change', loadDashboardData);
        document.getElementById('dashboard-refresh-btn').addEventListener('click', loadDashboardData);
        
        document.getElementById('report-year-filter').addEventListener('change', updatePeriodSelector);
        document.getElementById('report-type').addEventListener('change', updatePeriodSelector);
        document.getElementById('generate-report-btn').addEventListener('click', generateProfessionalReport);
        document.getElementById('download-pdf-btn').addEventListener('click', downloadReportAsPDF);
        document.getElementById('download-director-word-btn').addEventListener('click', downloadDirectorWordReport);
        
        populateYearFilters().then(() => {
            updateMonthFilterOptions();
            updatePeriodSelector();
            loadDashboardData();
        });
    };

    const loadDashboardData = async () => {
        const container = document.getElementById('dashboard-container');
        if (!container) return;

        const selectedYear = document.getElementById('dashboard-year-filter').value;
        const selectedMonth = document.getElementById('dashboard-month-filter').value;
        const yearStart = `${selectedYear}-01-01`;
        const yearEnd = `${selectedYear}-12-31`;
        const selectedYearInt = parseInt(selectedYear);

        let currentMonthStart, currentMonthEnd, prevMonthStart, prevMonthEnd, refDate;

        if (selectedMonth === 'all') {
            currentMonthStart = yearStart;
            currentMonthEnd = yearEnd;
            prevMonthStart = `${selectedYearInt - 1}-01-01`;
            prevMonthEnd = `${selectedYearInt - 1}-12-31`;
            refDate = new Date(selectedYearInt, 11, 15);
        } else {
            const selectedMonthInt = parseInt(selectedMonth);
            refDate = new Date(selectedYearInt, selectedMonthInt, 15);
            currentMonthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1).toISOString().split('T')[0];
            currentMonthEnd = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).toISOString().split('T')[0];
            prevMonthStart = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1).toISOString().split('T')[0];
            prevMonthEnd = new Date(refDate.getFullYear(), refDate.getMonth(), 0).toISOString().split('T')[0];
        }

        try {
            const wasteTables = ['special_waste', 'hazardous_waste', 'assimilable_waste'];
            const wastePromises = wasteTables.map(table =>
                fetchAll(db.from(table).select('date, weight_kg').gte('date', yearStart).lte('date', yearEnd))
            );

            const invoicesQuery = fetchAll(db.from('monthly_invoices')
                .select('purchase_order_number, billing_cycle_start, billing_cycle_end, pre_invoice_amount_iva')
                .gte('billing_cycle_end', yearStart).lte('billing_cycle_end', yearEnd));

            const [yearlySpecial, yearlyHazardous, yearlyAssimilable, equipment, activeLoans, invoices] = await Promise.all([
                ...wastePromises,
                fetchAll(db.from('equipment').select('id, name, status')),
                fetchAll(db.from('equipment_loans').select('equipment_id, return_date').is('return_date', null)),
                invoicesQuery
            ]);

            if (!document.getElementById('dashboard-container')) return;

            const yearlyWaste = [
                ...yearlySpecial.map(d => ({ ...d, type: 'special_waste' })),
                ...yearlyHazardous.map(d => ({ ...d, type: 'hazardous_waste' })),
                ...yearlyAssimilable.map(d => ({ ...d, type: 'assimilable_waste' }))
            ];

            const currentMonthWaste = yearlyWaste.filter(d => d.date >= currentMonthStart && d.date <= currentMonthEnd);
            const prevMonthWaste = yearlyWaste.filter(d => d.date >= prevMonthStart && d.date <= prevMonthEnd);

            const dedupedInvoices = dedupeInvoices(invoices || []);
            const periodInvoices = dedupedInvoices.filter(inv => {
                if (!inv || !inv.billing_cycle_end) return false;
                const endDateStr = String(inv.billing_cycle_end).split(' ')[0];
                return endDateStr >= currentMonthStart && endDateStr <= currentMonthEnd;
            });
            renderKPIs({ yearlyWaste, invoices: dedupedInvoices, periodInvoices, equipment });
            renderWasteCharts(yearlyWaste);
            renderMonthSummary(currentMonthWaste, prevMonthWaste, refDate, selectedMonth === 'all');
            renderResourceStatus(equipment, activeLoans);

        } catch (error) {
            console.error("Error loading dashboard:", error);
        }
    };

    const renderKPIs = (data) => {
        const { yearlyWaste, invoices, equipment } = data;
        const container = document.getElementById('dashboard-kpis');
        if (!container) return;

        const totals = yearlyWaste.reduce((acc, curr) => {
            const weight = parseFloat(curr.weight_kg) || 0;
            if (curr.type === 'special_waste') acc.special += weight;
            else if (curr.type === 'hazardous_waste') acc.hazardous += weight;
            else if (curr.type === 'assimilable_waste') acc.assimilable += weight;
            acc.total += weight;
            return acc;
        }, { special: 0, hazardous: 0, assimilable: 0, total: 0 });

        const periodCost = dedupeInvoices(Array.isArray(invoices) ? invoices : []).reduce((sum, inv) => sum + (parseFloat(inv.pre_invoice_amount_iva) || 0), 0);
        const availableEquipment = equipment.filter(e => e.status === 'Disponible').length;

        const kpis = [
            { id: 'total-waste', title: 'Total Residuos Generados', value: `${totals.total.toFixed(1)} kg`, icon: 'fa-trash-alt', color: 'blue', filter: true },
            { id: 'annual-cost', title: 'Costo Facturado (OC)', value: `$${Math.round(periodCost).toLocaleString('es-CL')}`, icon: 'fa-dollar-sign', color: 'green' },
            { id: 'available-equipment', title: 'Equipos Disponibles', value: availableEquipment, icon: 'fa-check-circle', color: 'teal' }
        ];

        container.innerHTML = kpis.map(kpi => `
        <div class="kpi-card">
            <div class="flex items-center">
                <div class="kpi-icon ${kpi.color}"><i class="fas ${kpi.icon}"></i></div>
                <div class="ml-4">
                    <div class="flex items-center gap-2">
                         <p class="text-sm text-gray-500 font-medium">${kpi.title}</p>
                         ${kpi.filter ? `<select id="kpi-waste-filter" class="text-xs p-1 border-0 rounded bg-gray-100"><option value="all">Todos</option><option value="special_waste">Especial</option><option value="hazardous_waste">Peligroso</option><option value="assimilable_waste">Asimilable</option></select>` : ''}
                    </div>
                    <p id="kpi-value-${kpi.id}" class="text-2xl font-bold text-gray-800">${kpi.value}</p>
                </div>
            </div>
        </div>`).join('');

        const kpiFilter = document.getElementById('kpi-waste-filter');
        if (kpiFilter) {
            kpiFilter.addEventListener('change', (e) => {
                const filter = e.target.value;
                let value = 0;
                if (filter === 'all') value = totals.total;
                else if (filter === 'special_waste') value = totals.special;
                else if (filter === 'hazardous_waste') value = totals.hazardous;
                else if (filter === 'assimilable_waste') value = totals.assimilable;
                document.getElementById('kpi-value-total-waste').textContent = `${value.toFixed(1)} kg`;
            });
        }
    };
    
    // -----------------------------------------------------------------------------
    // 4. LOGICA DE GENERACIÓN DE REPORTES
    // -----------------------------------------------------------------------------
    const generateDirectorWordReport = (analysisData) => {
        const { periodTotals, specialSubcategories, hazardousSubcategories, recyclingTotals, invoicesData, agreements, periodEndDate } = analysisData;
        const getCost = (kg, wasteType) => {
            const agreement = agreementsCache.find(a => a.razon_social.toUpperCase().includes("PROCESOS SANITARIOS"));
            if (!agreement) return 0;
            const price = wasteType === 'special' ? (parseFloat(agreement.price_per_kg_special_iva) || 0) : (parseFloat(agreement.price_per_kg_hazardous_iva) || 0);
            return kg * price;
        };
        const formatCLP = (num) => `$${Math.round(num || 0).toLocaleString('es-CL')}`;
        
        const citotoxicosKg = hazardousSubcategories.find(h => h.type.toUpperCase().includes('CITOTOXICOS'))?.kg || 0;
        const farmacosCaducosKg = hazardousSubcategories.find(h => h.type.toUpperCase().includes('MEDICAMENTOS VENCIDOS'))?.kg || 0;
        const conHgKg = hazardousSubcategories.find(h => h.type.toUpperCase().includes('MERCURIO') || h.type.toUpperCase().includes('HG'))?.kg || 0;
        const peligrososGeneralesKg = periodTotals.hazardous - (citotoxicosKg + farmacosCaducosKg + conHgKg);
        const cortopunzantesKg = specialSubcategories.find(s => s.category.toUpperCase() === 'CORTO-PUNZANTES')?.period || 0;
        const patologicosKg = specialSubcategories.find(s => s.category.toUpperCase() === 'PATOLOGICOS')?.period || 0;
        const contaminadosKg = specialSubcategories.find(s => s.category.toUpperCase() === 'SANGRE Y PRODUCTOS DERIVADOS')?.period || 0;
        const asimilablesKg = periodTotals.assimilable;
        const papelKg = recyclingTotals['Papel'] || 0;
        const cartonKg = recyclingTotals['Cartón'] || 0;
        const aceiteLit = recyclingTotals['Aceite'] || 0;
        const totalRecicladoKg = papelKg + cartonKg; 
        
        const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
        const reportDate = new Date(periodEndDate);
        const dynamicDateString = `${monthNames[reportDate.getUTCMonth()]}, ${reportDate.getUTCFullYear()}`;
        
        const facturasDevengadasParagraph = `- Reporte trimestral de facturas devengadas asociadas al transporte y disposición final de Residuos Peligrosos y Residuos Especiales, en el mes de septiembre aún no se tiene el devengo dado que la orden compra aun está en gestión.`;

        return `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset='utf-8'><title>Informe REAS</title>
            <style>
                @page WordSection1 { size: 21.59cm 27.94cm; margin: 2.5cm 2.5cm 2.5cm 3cm; mso-header-margin: 1.27cm; mso-footer-margin: 1.27cm; mso-paper-source: 0; }
                div.WordSection1 { page: WordSection1; }
                body { font-family: Calibri, sans-serif; font-size: 11pt; color: black; }
                p, li { margin: 0 0 8px 0; line-height: 1.4; text-align: justify; }
                ul { margin-top: 5px; margin-bottom: 5px; padding-left: 40px; list-style: none; }
                table { border-collapse: collapse; width: 100%; font-size: 11pt; }
                td, th { border: 1px solid black; padding: 5px; text-align: left; vertical-align: top; }
                h3 { font-weight: bold; font-size: 12pt; margin: 24px 0 12px 0; }
                .cover-table { width: 100%; border: none; height: 90vh; }
                .cover-table td { border: none; }
            </style>
            </head>
            <body>
            <div class="WordSection1">
                <table class="cover-table">
                    <tr>
                        <td style="width: 50%; background-color: #0033A0; vertical-align: top; padding: 20px;">
                            <img src="${window.APP_CONFIG.HOSPITAL_LOGO_BASE64}" alt="Logo Gobierno de Chile" width="150">
                        </td>
                        <td style="width: 50%; background-color: #E6332A; vertical-align: top; padding: 20px; color: white;">
                            <p style="font-size: 24pt; font-weight: bold; margin: 0; text-align: left;">Hospital<br>Penco Lirquén</p>
                            <p style="font-size: 14pt; margin: 0; text-align: left;">Servicio Salud Talcahuano</p>
                            <div style="position: absolute; bottom: 80px; right: 40px;">
                                 <p style="font-size: 14pt; font-weight: bold; margin: 0; text-align: right;">Ministerio de Salud</p>
                            </div>
                        </td>
                    </tr>
                      <tr>
                        <td colspan="2" style="text-align: center; vertical-align: middle;">
                            <p style="font-size: 16pt; font-weight: bold;">ESTABLECIMIENTO AUTOGESTIONADO EN RED</p>
                            <p style="font-size: 16pt; font-weight: bold; text-decoration: underline;">INDICADOR (A.3_1.7)</p>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="2" style="text-align: right; vertical-align: bottom; padding: 40px;">
                            <p style="margin-bottom: 60px;"><strong>Firma:</strong> _________________________</p>
                            <p style="margin: 0; font-weight: bold;">Patricia Paulos Villarreal</p>
                            <p style="margin: 0;"><strong>Directora</strong></p>
                            <br/>
                            <p style="margin: 0;">"${dynamicDateString}"</p>
                        </td>
                    </tr>
                </table>

                <br clear=all style='mso-special-character:line-break;page-break-before:always'>

                <h3>1. Antecedentes del Indicador</h3>
                <table>
                    <tr><td style="width: 25%;"><strong>Nombre del Indicador</strong></td><td>Porcentaje de cumplimiento de actividades en la gestión de residuos de establecimientos autogestionados en red (REAS)</td></tr>
                    <tr><td><strong>Objetivos</strong></td><td>Monitorear los procesos críticos que impacten en el buen uso de los recursos y la correcta gestión REAS en los establecimientos</td></tr>
                    <tr><td><strong>Formula</strong></td><td>(Número de actividades exigidas cumplidas/Total de actividades exigidas) x 100*Para registro en SIS.Q, una vez cumplido (según periodicidad) se ingresa SI, el resto de los meses N/A mensual.</td></tr>
                    <tr><td><strong>Fuente de datos</strong></td><td>Para punto 1, 2 y 3, sistema sectorial SIDREP y SINADER, alojado en ventanilla única https://vu.mma.gob.cl/index.php?c=home. Para punto 4, Registros internos de los responsables del manejo de residuos asimilables a domiciliario, como recursos Físicos, Servicios Generales u otro atingente (Ver Anexo N°03). Para punto 5, Registros en SIGFE (Planilla de elaboración propia, con registros trimestrales de facturas devengadas por el establecimiento).</td></tr>
                </table>

                <br clear=all style='mso-special-character:line-break;page-break-before:always'>
                
                <h3>Verificador del mes informado:</h3>
                <p><strong>1) Registro de Residuos Peligrosos (ANEXO I):</strong></p>
                <ul>
                    <li>- Cantidad Residuos Peligrosos: ${peligrososGeneralesKg.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg. / Gasto periodo ${formatCLP(getCost(peligrososGeneralesKg, 'hazardous'))}.-</li>
                    <li>- Cantidad Residuos Peligrosos Fármacos Caducos: ${farmacosCaducosKg.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg. / Gasto periodo ${formatCLP(getCost(farmacosCaducosKg, 'hazardous'))}.-</li>
                    <li>- Cantidad Residuos Citotóxicos: ${citotoxicosKg.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg. / Gasto periodo ${formatCLP(getCost(citotoxicosKg, 'hazardous'))}.-</li>
                    <li>- Cantidad Residuos Peligrosos Con Hg: ${conHgKg.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg. / Gasto periodo ${formatCLP(getCost(conHgKg, 'hazardous'))}.-</li>
                    <li>- Monitoreo y reporte trimestral del registro de Residuos Peligrosos (Captura de Pantalla sistema sectorial SIDREP).</li>
                </ul>
                <p><strong>2) Registro de Residuos Especiales (ANEXO I):</strong></p>
                <ul>
                    <li>- Residuos Cortopunzantes ${cortopunzantesKg.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg. / Gasto periodo ${formatCLP(getCost(cortopunzantesKg, 'special'))}.-</li>
                    <li>- Residuos patológicos ${(patologicosKg * 1000).toLocaleString('es-CL', { maximumFractionDigits: 0 })} g. / Gasto periodo ${formatCLP(getCost(patologicosKg, 'special'))}.-</li>
                    <li>- Residuos Contaminados ${contaminadosKg.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg. / Gasto periodo ${formatCLP(getCost(contaminadosKg, 'special'))}.-</li>
                    <li>- Monitoreo y reporte trimestral del registro de Residuos Especiales (Captura de Pantalla sistema sectorial SIDREP).</li>
                </ul>
                <p><strong>3) Registro de Residuos plásticos</strong></p>
                <ul><li>- Monitoreo no aplica durante el cuarto trimestre según indicación MINSAL.</li></ul>
                <p><strong>4) Registro Residuos no Peligrosos:</strong></p>
                <p style="margin-left: 20px;"><strong>Asimilables a Domicilio (ANEXO II)</strong></p>
                <ul>
                    <li>- El retiro de los residuos asimilables a domiciliarios se esta realizando de lunes a domingo por parte de la recolección municipal sin costo asociado. Se contemplan algunas intermitencias por fallas mecánicas en los camiones recolectores durante algunos días. Se apoya el retiro los fines de semana con una tolva dejada el dia viernes en la tarde y retirada el día lunes en el día.</li>
                    <li>- Cantidad de Residuos Asimilables a Domiciliarios ${asimilablesKg.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg. / Gasto periodo $0.-</li>
                    <li>- Monitoreo y reporte trimestral del registro de Residuos asimilables a Reciclado (Planilla Anexo 03 de costos y generación según ficha del indicador).</li>
                </ul>
                <p style="margin-left: 20px;"><strong>Asimilables a Reciclado (ANEXO II)</strong></p>
                <ul>
                    <li>- Se mantiene el reciclaje de papel, cartón y aceite de cocinar en nuestro establecimiento.</li>
                    <li>- Cantidad de Papeles reciclados ${papelKg.toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg. / Gasto Periodo $0.-</li>
                    <li>- Cantidad cartón reciclado ${cartonKg.toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg. / Gasto Periodo $0.-</li>
                    <li>- Cantidad Aceite reciclado ${aceiteLit.toLocaleString('es-CL', { maximumFractionDigits: 2 })} lit. / Gasto Periodo $0.-</li>
                    <li>- Monitoreo y reporte trimestral del registro de Residuos asimilables a Reciclado (Planilla Anexo 03 de costos y generación según ficha del indicador).</li>
                </ul>
                <p><strong>5) Monto del pago de facturas asociadas a gestión de REAS (ANEXO III):</strong></p>
                <ul>
                    <li>- Se mantiene convenio de licitación con empresa Procesos sanitarios SpA hasta febrero del 2027, sin interrupciones del servicio con frecuencia de 3 retiros a la semana, los lunes, miércoles y viernes.</li>
                    <li>${facturasDevengadasParagraph} (Registros en SIGFE y planilla de elaboración propia con registros trimestrales de facturas REAS devengadas por el establecimiento).</li>
                </ul>

                <br clear=all style='mso-special-character:line-break;page-break-before:always'>
                <h3>Anexos</h3>
                <p><strong>Anexo I: Monitoreo y reporte trimestral del registro de Residuos Peligrosos y Residuos Especiales.</strong></p>
                <p>Captura de pantalla sobre los registros de residuos declarados en Plataforma SIDREP.</p>
                <div style="border: 1px solid #ccc; padding: 10px; font-family: sans-serif; font-size: 10pt;">
                    <p style="font-weight: bold; background-color: #f0f0f0; padding: 5px;">Listado de Declaraciones</p>
                    <table style="font-size: 9pt; width: 100%; border: 1px solid #ccc;">
                        <thead style="background-color: #388e3c; color: white;">
                            <tr><th style="border: 1px solid #ccc;">Folio</th><th style="border: 1px solid #ccc;">Estado</th><th style="border: 1px solid #ccc;">Generador</th><th style="border: 1px solid #ccc;">Transportista</th><th style="border: 1px solid #ccc;">Destinatario/Transferencia</th><th style="border: 1px solid #ccc;">Fecha</th><th style="border: 1px solid #ccc;">Acción</th></tr>
                        </thead>
                        <tbody>
                            <tr><td>2033370</td><td>Anulado</td><td>61602198-2 | SERVICIO NACIONAL DE SALUD HOSPITAL DE L</td><td>96697710-8 | PROCESOS SANITARIOS SPA</td><td>96697710-8 | PROCESOS SANITARIOS SPA</td><td>29/09/2025 08:33 am</td><td>VER</td></tr>
                            <tr style="background-color: #f9f9f9;"><td>2033388</td><td>Anulado</td><td>61602198-2 | SERVICIO NACIONAL DE SALUD HOSPITAL DE L</td><td>96697710-8 | PROCESOS SANITARIOS SPA</td><td>96697710-8 | PROCESOS SANITARIOS SPA</td><td>29/09/2025 08:33 am</td><td>VER</td></tr>
                            <tr><td>2028027</td><td>Cerrado</td><td>61602198-2 | SERVICIO NACIONAL DE SALUD HOSPITAL DE L</td><td>96697710-8 | PROCESOS SANITARIOS SPA</td><td>96697710-8 | PROCESOS SANITARIOS SPA</td><td>30/09/2025 10:57 am</td><td>VER</td></tr>
                            <tr style="background-color: #f9f9f9;"><td>2031010</td><td>Cerrado</td><td>61602198-2 | SERVICIO NACIONAL DE SALUD HOSPITAL DE L</td><td>96697710-8 | PROCESOS SANITARIOS SPA</td><td>96697710-8 | PROCESOS SANITARIOS SPA</td><td>29/09/2025 02:14 pm</td><td>VER</td></tr>
                        </tbody>
                    </table>
                </div>

                <br clear=all style='mso-special-character:line-break;page-break-before:always'>
                <p><strong>Anexo II: Monitoreo y reporte trimestral de la cantidad de Residuos Asimilables a Domiciliario.</strong></p>
                <p>Planilla de registro (Anexo 03 de costos y generación según ficha del indicador).</p>
                <br>
                <table style="font-size: 6pt; text-align: center; vertical-align: middle;">
                    <thead>
                        <tr style="color: white; font-weight: bold;">
                            <th colspan="8" style="background-color: #002060;">TIPO Y NIVEL DE COMPLEJIDAD DEL ESTABLECIMIENTO</th>
                            <th colspan="6" style="background-color: #FFFF00; color: black;">RESIDUOS ESPECIALES</th>
                            <th colspan="10" style="background-color: #FF0000;">RESIDUOS PELIGROSOS</th>
                            <th colspan="2" style="background-color: #D9D9D9; color: black;">RESIDUOS ASIMILABLES</th>
                            <th colspan="3" style="background-color: #C6E0B4; color: black;">RESIDUOS RECICLABLES</th>
                        </tr>
                        <tr style="color: white; font-weight: bold; background-color: #002060;">
                            <th>CODIGO DES</th><th>SERVICIO</th><th>ESTABLECIMIENTO</th><th>TIPO Y NIVEL...</th><th>ESTABLECIMIENTO AUTOGESTIONADO</th><th>% de Ocupacional...</th><th>N° de camas</th><th>N° de egresos</th>
                            <th style="background-color: #FFFF00; color: black;">Generación (Kg) CORTOPUNZANTES</th><th style="background-color: #FFFF00; color: black;">Gasto $ CORTOPUNZANTES</th>
                            <th style="background-color: #FFFF00; color: black;">Generación (Kg) PATOLOGICOS</th><th style="background-color: #FFFF00; color: black;">Gasto $ PATOLOGICOS</th>
                            <th style="background-color: #FFFF00; color: black;">Generación (Kg) CONTAMINADOS</th><th style="background-color: #FFFF00; color: black;">Gasto ($) CONTAMINADOS</th>
                            <th style="background-color: #FF0000;">Generación (Kg) PELIGROSOS</th><th style="background-color: #FF0000;">Gasto ($) PELIGROSOS</th>
                            <th style="background-color: #FF0000;">Generación (Kg) Con Hg</th><th style="background-color: #FF0000;">Gasto $ Con Hg</th>
                            <th style="background-color: #FF0000;">Generación (Kg) Fármacos Caducos</th><th style="background-color: #FF0000;">Gasto $ Fármacos Caducos</th>
                            <th style="background-color: #FF0000;">Generación (Kg) CITOSTATICOS</th><th style="background-color: #FF0000;">Gasto ($) CITOSTATICOS</th>
                            <th style="background-color: #FF0000;">Generación (Kg) RADIOACTIVOS</th><th style="background-color: #FF0000;">Gasto ($) RADIOACTIVOS</th>
                            <th style="background-color: #D9D9D9; color: black;">Generación (Kg) ASIMILABLES</th><th style="background-color: #D9D9D9; color: black;">Gasto ($) ASIMILABLES</th>
                            <th style="background-color: #C6E0B4; color: black;">Generación (Kg) RECICLABLES</th><th style="background-color: #C6E0B4; color: black;">Gasto/ingreso ($) RECICLABLES</th><th style="background-color: #C6E0B4; color: black;">OBSERVACIONES</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>110102</td><td>Talcahuano</td><td>Hospital Penco-Lirquen (Penco)</td><td>Media Complejidad</td><td>Autogestionado en Red</td><td>XX.X%</td><td>XX</td><td>XXX</td>
                            <td>${cortopunzantesKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>${formatCLP(getCost(cortopunzantesKg, 'special'))}</td>
                            <td>${patologicosKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>${formatCLP(getCost(patologicosKg, 'special'))}</td>
                            <td>${contaminadosKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>${formatCLP(getCost(contaminadosKg, 'special'))}</td>
                            <td>${peligrososGeneralesKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>${formatCLP(getCost(peligrososGeneralesKg, 'hazardous'))}</td>
                            <td>${conHgKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>${formatCLP(getCost(conHgKg, 'hazardous'))}</td>
                            <td>${farmacosCaducosKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>${formatCLP(getCost(farmacosCaducosKg, 'hazardous'))}</td>
                            <td>${citotoxicosKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>${formatCLP(getCost(citotoxicosKg, 'hazardous'))}</td>
                            <td>0.00</td><td>$0</td>
                            <td>${asimilablesKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>$0</td>
                            <td>${totalRecicladoKg.toLocaleString('es-CL', {maximumFractionDigits:2})}</td><td>$0</td>
                            <td>Reciclaje de ${papelKg.toLocaleString('es-CL')} kg de papel y ${cartonKg.toLocaleString('es-CL')} kg de cartón.</td>
                        </tr>
                    </tbody>
                </table>

                <br clear=all style='mso-special-character:line-break;page-break-before:always'>
                
                <p><strong>Anexo III: Reporte trimestral de facturas devengadas asociadas al transporte y disposición final de Residuos Peligrosos y Residuos Especiales.</strong></p>
                <p>Planilla Interna de gastos</p>
                <br/>
                <table style="font-size: 10pt;">
                    <thead>
                        <tr style="background-color: #f2f2f2;">
                            <th>Cuentas por Pagar...</th>
                            <th>Proveedor</th>
                            <th>Fecha</th>
                            <th>Folio Devengo</th>
                            <th>Detalle</th>
                            <th>Monto</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(invoicesData || []).map(inv => {
                            const agreement = agreements.find(a => a.id === inv.agreement_id) || {};
                            const detail = `FA//${inv.purchase_order_number || ''}/${inv.id_licitacion_placeholder || '1057540-16946-SE25'}/ ${agreement.rut_proveedor || ''} /${agreement.licitacion_id || '1057540-1-LP25'}/`;
                            return `
                                <tr>
                                    <td>21522 Cuentas por Pagar - Bienes y Servicios de Consumo</td>
                                    <td>${agreement.rut_proveedor || ''} ${inv.agreement_name || 'PROCESOS SANITARIOS SPA'}</td>
                                    <td>${new Date(inv.billing_cycle_end + 'T00:00:00').toLocaleDateString('es-CL', {day: '2-digit', month: '2-digit', year: 'numeric'})}</td>
                                    <td>${inv.folio_devengo_placeholder || ''}</td>
                                    <td>${detail}</td>
                                    <td>${formatCLP(inv.pre_invoice_amount_iva)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            </body>
            </html>
        `;
    };

    const downloadDirectorWordReport = async () => {
        const btn = document.getElementById('download-director-word-btn');
        btn.disabled = true;
        btn.innerHTML = `<div class="loader !w-5 !h-5 !border-2 mr-2"></div> Generando...`;

        try {
            const year = document.getElementById('report-year-filter').value;
            const periodType = document.getElementById('report-type').value;
            const periodIndex = document.getElementById('report-period-select').value;
            const { current: currentPeriod } = getDateRanges(parseInt(year), periodType, parseInt(periodIndex));
            
            const [currentWaste, invoicesData, recyclingData] = await Promise.all([
                getWasteDataForPeriod(currentPeriod.start, currentPeriod.end),
                fetchAll(db.from('monthly_invoices').select('*, waste_removal_agreements(razon_social, rut_proveedor)').gte('billing_cycle_end', currentPeriod.start.toISOString().split('T')[0]).lte('billing_cycle_end', currentPeriod.end.toISOString().split('T')[0])),
                fetchAll(db.from('recycling_log').select('*').gte('date', currentPeriod.start.toISOString().split('T')[0]).lte('date', currentPeriod.end.toISOString().split('T')[0]))
            ]);
            
            const currentGroup = groupWaste(currentWaste);
            const periodTotals = sumWasteValues(currentGroup);
            const specialSubcategories = Object.keys(window.APP_CONFIG.wasteTypeOptions.special_waste_categories).map(cat => ({ category: cat, period: currentGroup.special[cat] || 0 }));
            const hazardousSubcategories = Object.entries(currentGroup.hazardous).map(([type, kg]) => ({ type, kg }));
            const recyclingTotals = (recyclingData || []).reduce((acc, record) => { const material = record.material_type; const weight = parseFloat(record.weight_kg) || 0; acc[material] = (acc[material] || 0) + weight; return acc; }, {});

            const analysisData = { periodTotals, specialSubcategories, hazardousSubcategories, recyclingTotals, invoicesData: dedupeInvoices(invoicesData), agreements: agreementsCache, periodEndDate: currentPeriod.end };
            
            const htmlContent = generateDirectorWordReport(analysisData);
            const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Informe_Directora_REAS_${year}_${periodType}_${parseInt(periodIndex)+1}.doc`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error("Error generating director's Word report:", error);
            alert("Error al generar el informe.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-file-word mr-2"></i>Descargar Word (Directora)';
        }
    };

    const renderMonthSummary = (currentMonthData, prevMonthData, refDate) => {
        const container = document.getElementById('dashboard-month-summary');
        if (!container) return;
        const process = (data) => data.reduce((acc, curr) => {
            const weight = parseFloat(curr.weight_kg) || 0;
            if (curr.type === 'special_waste') acc.special += weight;
            else if (curr.type === 'hazardous_waste') acc.hazardous += weight;
            else if (curr.type === 'assimilable_waste') acc.assimilable += weight;
            acc.total += weight;
            return acc;
        }, { special: 0, hazardous: 0, assimilable: 0, total: 0 });
        const currentTotals = process(currentMonthData);
        const prevTotals = process(prevMonthData);
        const renderVar = (variation) => {
            if (variation === Infinity) return `<span class="var-tag new">Nuevo</span>`;
            if (!isFinite(variation) || Math.abs(variation) < 0.1) return `<span class="var-tag neutral">-</span>`;
            const color = variation > 5 ? 'bad' : variation < -5 ? 'good' : 'neutral';
            const icon = variation > 0 ? '▲' : '▼';
            return `<span class="var-tag ${color}">${icon} ${Math.abs(variation).toFixed(0)}%</span>`;
        };
        const summaryItems = [
            { label: 'Especiales', current: currentTotals.special, previous: prevTotals.special, color: 'border-yellow-500' },
            { label: 'Peligrosos', current: currentTotals.hazardous, previous: prevTotals.hazardous, color: 'border-red-500' },
            { label: 'Asimilables', current: currentTotals.assimilable, previous: prevTotals.assimilable, color: 'border-green-500' }
        ];
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const currentMonthName = monthNames[refDate.getMonth()];
        const prevMonthDate = new Date(refDate);
        prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
        const prevMonthName = monthNames[prevMonthDate.getMonth()];
        const year = refDate.getFullYear();
        container.innerHTML = `
            <h2 class="text-xl font-bold text-gray-800 mb-4">Resumen: ${currentMonthName} vs. ${prevMonthName} ${year}</h2>
            <div class="space-y-4">
                ${summaryItems.map(item => `
                    <div class="flex justify-between items-center p-3 rounded-lg bg-gray-50 border-l-4 ${item.color}">
                        <span class="font-medium text-gray-700">${item.label}</span>
                        <div class="text-right">
                            <strong class="text-lg text-gray-800">${item.current.toFixed(1)} kg</strong>
                            <div class="flex items-center justify-end gap-2">
                                <span class="text-xs text-gray-500">vs ${item.previous.toFixed(1)} kg</span>
                                ${renderVar(calcVariation(item.current, item.previous))}
                            </div>
                        </div>
                    </div>`).join('')}
            </div>`;
    };

    const renderResourceStatus = (equipment, activeLoans) => {
        const container = document.getElementById('dashboard-resource-status');
        if (!container) return;
        const statusCounts = equipment.reduce((acc, eq) => {
            const status = activeLoans.some(l => l.equipment_id === eq.id) ? 'En Préstamo' : eq.status;
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});
        container.innerHTML = `
             <h2 class="text-xl font-bold text-gray-800 mb-4">Estado de Recursos</h2>
             <div class="border-t pt-4">
                <h3 class="font-semibold text-gray-700 mb-2">Equipos</h3>
                <div class="space-y-1">
                    <div class="flex justify-between text-sm py-1"><span><i class="fas fa-check-circle text-green-500 mr-2"></i>Disponibles</span> <span class="font-bold">${statusCounts['Disponible'] || 0}</span></div>
                    <div class="flex justify-between text-sm py-1"><span><i class="fas fa-exchange-alt text-yellow-500 mr-2"></i>En Préstamo</span> <span class="font-bold">${statusCounts['En Préstamo'] || 0}</span></div>
                    <div class="flex justify-between text-sm py-1"><span><i class="fas fa-tools text-blue-500 mr-2"></i>En Mantenimiento</span> <span class="font-bold">${statusCounts['En Mantenimiento'] || 0}</span></div>
                </div>
             </div>`;
    };

    const generateProfessionalReport = async () => {
        const btn = document.getElementById('generate-report-btn');
        // CORRECCIÓN 1: Verificar existencia del botón antes de modificarlo
        if (btn) {
            btn.disabled = true; 
            btn.innerHTML = `<div class="loader !w-5 !h-5 !border-2 mr-2"></div> Generando...`;
        }

        // Obtener valores de forma segura (asumiendo que estos inputs existen si se llamó a la función)
        const yearEl = document.getElementById('dashboard-year-filter');
        const typeEl = document.getElementById('report-type');
        const periodEl = document.getElementById('report-period-select');

        if (!yearEl || !typeEl || !periodEl) {
            console.error("Faltan selectores de filtro.");
            if (btn) { btn.disabled = false; btn.innerHTML = 'Generar Informe General'; }
            return;
        }

        const year = yearEl.value;
        const periodType = typeEl.value;
        const periodIndex = periodEl.value;
        const { current: currentPeriod, previous: previousPeriod, label } = getDateRanges(parseInt(year), periodType, parseInt(periodIndex));

        const logoBase64 = window.APP_CONFIG.HOSPITAL_LOGO_BASE64;

        try {
            const yearStart = new Date(parseInt(year), 0, 1);
            const yearEnd = new Date(parseInt(year), 11, 31);

            const monthlyRanges = getMonthlyRanges(currentPeriod.start, currentPeriod.end);
            const monthlyWastePromises = monthlyRanges.map(range => getWasteDataForPeriod(range.start, range.end));

            const invoiceRangeStart = new Date(Date.UTC(currentPeriod.start.getUTCFullYear(), currentPeriod.start.getUTCMonth(), currentPeriod.start.getUTCDate()));
            const invoiceRangeEnd = new Date(Date.UTC(currentPeriod.end.getUTCFullYear(), currentPeriod.end.getUTCMonth(), currentPeriod.end.getUTCDate()));
            const prevInvoiceRangeStart = new Date(Date.UTC(previousPeriod.start.getUTCFullYear(), previousPeriod.start.getUTCMonth(), previousPeriod.start.getUTCDate()));
            const prevInvoiceRangeEnd = new Date(Date.UTC(previousPeriod.end.getUTCFullYear(), previousPeriod.end.getUTCMonth(), previousPeriod.end.getUTCDate()));

            const invoicesQuery = fetchAll(db.from('monthly_invoices')
                .select('*, waste_removal_agreements(razon_social, rut_proveedor)')
                .gte('billing_cycle_end', invoiceRangeStart.toISOString().split('T')[0])
                .lte('billing_cycle_end', invoiceRangeEnd.toISOString().split('T')[0]));

            const prevInvoicesQuery = fetchAll(db.from('monthly_invoices')
                .select('purchase_order_number, billing_cycle_start, billing_cycle_end, pre_invoice_kg_special, pre_invoice_kg_hazardous, pre_invoice_amount_iva')
                .gte('billing_cycle_end', prevInvoiceRangeStart.toISOString().split('T')[0])
                .lte('billing_cycle_end', prevInvoiceRangeEnd.toISOString().split('T')[0]));

            const recyclingQuery = fetchAll(db.from('recycling_log')
                .select('*')
                .gte('date', currentPeriod.start.toISOString().split('T')[0])
                .lte('date', currentPeriod.end.toISOString().split('T')[0]));

            const recyclingYearlyQuery = fetchAll(db.from('recycling_log')
                .select('*')
                .gte('date', yearStart.toISOString().split('T')[0])
                .lte('date', yearEnd.toISOString().split('T')[0]));

            const [
                currentWaste, previousWaste, yearlyWasteForAnnex, allUnitsData,
                invoicesData, previousInvoicesData, recyclingData, recyclingYearlyData,
                ...monthlyWasteData
            ] = await Promise.all([
                getWasteDataForPeriod(currentPeriod.start, currentPeriod.end),
                getWasteDataForPeriod(previousPeriod.start, previousPeriod.end),
                getWasteDataForPeriod(yearStart, yearEnd),
                fetchAll(db.from('units').select('id, name')),
                invoicesQuery,
                prevInvoicesQuery,
                recyclingQuery,
                recyclingYearlyQuery,
                ...monthlyWastePromises
            ]);

            // CORRECCIÓN 2: Verificación crítica tras la espera asíncrona
            const reportOutput = document.getElementById('report-output');
            if (!reportOutput) {
                console.warn("El contenedor del reporte ya no existe (el usuario cambió de pantalla). Cancelando renderizado.");
                return;
            }

            const monthlyDataPackage = { ranges: monthlyRanges, data: monthlyWasteData };
            const dedupedInvoicesData = dedupeInvoices(invoicesData || []);
            const dedupedPreviousInvoicesData = dedupeInvoices(previousInvoicesData || []);
            
            const analysisData = processAdvancedReportData({
                currentWaste, previousWaste, yearlyWasteForAnnex, allUnits: allUnitsData,
                invoices: dedupedInvoicesData, previousInvoices: dedupedPreviousInvoicesData,
                recyclingData, recyclingYearlyData,
                currentPeriod, previousPeriod, label, logoBase64,
                monthlyDataPackage
            });

            const reportHTML = renderAdvancedReport(analysisData);

            reportOutput.innerHTML = reportHTML;
            
            const wrapper = document.getElementById('report-output-wrapper');
            if (wrapper) {
                wrapper.classList.remove('hidden');
                wrapper.scrollIntoView({ behavior: 'smooth' });
            }

            const pdfBtnEl = document.getElementById('download-pdf-btn');
            if (pdfBtnEl) pdfBtnEl.classList.remove('hidden');
            const directorWordBtn = document.getElementById('download-director-word-btn');
            if (directorWordBtn) directorWordBtn.classList.remove('hidden');

            renderReportCharts(analysisData);

        } catch (error) {
            console.error("Error generating report:", error);
            alert("Error al recopilar datos para el informe: " + error.message);
        } finally {
            // CORRECCIÓN 3: Restaurar botón solo si aún existe en el DOM
            if (btn) {
                btn.disabled = false; 
                btn.innerHTML = 'Generar Informe General';
            }
        }
    };

    const downloadReportAsPDF = async () => {
        const { jsPDF } = window.jspdf;
        const downloadBtn = document.getElementById('download-pdf-btn');
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = `<div class="loader !w-5 !h-5 !border-2 mr-2"></div> Creando PDF...`;
        }

        setTimeout(async () => {
            Chart.defaults.animation = false;

            try {
                const reportPages = document.querySelectorAll('#report-output .report-page');
                if (reportPages.length === 0) throw new Error("No hay páginas para generar.");

                const pdf = new jsPDF({
                    orientation: 'portrait',
                    unit: 'mm',
                    format: 'letter'
                });

                for (let i = 0; i < reportPages.length; i++) {
                    const pageElement = reportPages[i];

                    const canvas = await html2canvas(pageElement, {
                        scale: 3,
                        useCORS: true,
                        logging: false,
                        width: pageElement.offsetWidth,
                        height: pageElement.offsetHeight,
                    });

                    const imgData = canvas.toDataURL('image/png');
                    const pdfWidth = pdf.internal.pageSize.getWidth();
                    const pdfHeight = pdf.internal.pageSize.getHeight();
                    const imgProps = pdf.getImageProperties(imgData);
                    const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

                    if (i > 0) {
                        pdf.addPage();
                    }

                    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, Math.min(imgHeight, pdfHeight));
                }

                pdf.save('Informe_GestionREAS.pdf');

            } catch (error) {
                console.error("Error creating PDF:", error);
                alert("Hubo un problema al generar el archivo PDF. Por favor, inténtelo de nuevo.");
            } finally {
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.innerHTML = `<i class="fas fa-file-pdf mr-2"></i>Descargar PDF`;
                }
                Chart.defaults.animation = {};
            }
        }, 500);
    };

    const processMonthlyAnnexData = (yearlyWasteData) => {
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthlySummary = monthNames.map(name => ({
            month: name,
            special: 0,
            hazardous: 0,
            assimilable: 0,
            total: 0
        }));

        const allWaste = [
            ...(yearlyWasteData.special || []).map(d => ({ ...d, category: 'special' })),
            ...(yearlyWasteData.hazardous || []).map(d => ({ ...d, category: 'hazardous' })),
            ...(yearlyWasteData.assimilable || []).map(d => ({ ...d, category: 'assimilable' }))
        ];

        allWaste.forEach(record => {
            const monthIndex = new Date(record.date).getUTCMonth();
            if (monthIndex >= 0 && monthIndex < 12) {
                const weight = parseFloat(record.weight_kg) || 0;
                monthlySummary[monthIndex][record.category] += weight;
                monthlySummary[monthIndex].total += weight;
            }
        });

        return monthlySummary;
    };

    const processAdvancedReportData = (sourceData) => {
        const {
            currentWaste, previousWaste, yearlyWasteForAnnex, allUnits,
            invoices, previousInvoices, recyclingData, recyclingYearlyData,
            currentPeriod, previousPeriod, label, logoBase64,
            monthlyDataPackage
        } = sourceData;

        const normalizeInvoices = (list) => {
            return (list || []).map(inv => {
                const out = { ...inv };
                out.pre_invoice_kg_special = parseFloat(inv.pre_invoice_kg_special) || 0;
                out.pre_invoice_kg_hazardous = parseFloat(inv.pre_invoice_kg_hazardous) || 0;
                out.pre_invoice_amount_iva = parseFloat(inv.pre_invoice_amount_iva) || 0;
                return out;
            });
        };
        const normalizedInvoices = normalizeInvoices(invoices);
        const normalizedPreviousInvoices = normalizeInvoices(previousInvoices);
        const dedupedNormalizedInvoices = dedupeInvoices(normalizedInvoices);
        const dedupedNormalizedPrevInvoices = dedupeInvoices(normalizedPreviousInvoices);

        const sumWasteValues = (wasteObj) => {
            const special = Object.values(wasteObj.special || {}).reduce((s, v) => {
                const num = parseFloat(v) || 0;
                return s + num;
            }, 0);
            const hazardous = Object.values(wasteObj.hazardous || {}).reduce((s, v) => {
                const num = parseFloat(v) || 0;
                return s + num;
            }, 0);
            const assimilable = parseFloat(wasteObj.assimilable || 0) || 0;
            const total = special + hazardous + assimilable;
            return { special, hazardous, assimilable, total };
        };

        const currentGroup = groupWaste(currentWaste);
        const previousGroup = groupWaste(previousWaste);

        const periodTotals = sumWasteValues(currentGroup);
        const previousPeriodTotals = sumWasteValues(previousGroup);

        const monthlyAnalysis = monthlyDataPackage.data.map((monthData, index) => {
            const groupedMonth = groupWaste(monthData);
            const monthTotals = sumWasteValues(groupedMonth);
            return {
                label: monthlyDataPackage.ranges[index].label,
                totals: monthTotals
            };
        });

        const generalCategoryAnalysis = ['special', 'hazardous', 'assimilable'].map(category => {
            const totalPeriod = periodTotals[category];
            const totalPreviousPeriod = previousPeriodTotals[category];
            const periodVariation = calcVariation(totalPeriod, totalPreviousPeriod);

            const monthlyVariations = [];
            if (monthlyAnalysis.length > 1) {
                for (let i = 1; i < monthlyAnalysis.length; i++) {
                    const currentMonthTotal = monthlyAnalysis[i].totals[category];
                    const prevMonthTotal = monthlyAnalysis[i - 1].totals[category];
                    monthlyVariations.push({
                        text: `Comparado con ${monthlyAnalysis[i - 1].label}, la generación en ${monthlyAnalysis[i].label}`,
                        variation: calcVariation(currentMonthTotal, prevMonthTotal)
                    });
                }
            }
            return { category, totalPeriod, periodVariation, monthlyVariations };
        });

        const costData = { total: 0, byProvider: {} };
        dedupedNormalizedInvoices.forEach(inv => {
            const provider = inv.waste_removal_agreements?.razon_social || 'Proveedor Desconocido';
            if (!costData.byProvider[provider]) {
                costData.byProvider[provider] = { special_kg: 0, hazardous_kg: 0, total_cost: 0 };
            }
            costData.byProvider[provider].special_kg += inv.pre_invoice_kg_special;
            costData.byProvider[provider].hazardous_kg += inv.pre_invoice_kg_hazardous;
            costData.byProvider[provider].total_cost += inv.pre_invoice_amount_iva;
        });
        costData.total = Object.values(costData.byProvider).reduce((sum, p) => sum + p.total_cost, 0);

        const sumInvoicedKg = (invList) => (invList || []).reduce((acc, inv) => {
            acc.special += inv.pre_invoice_kg_special;
            acc.hazardous += inv.pre_invoice_kg_hazardous;
            return acc;
        }, { special: 0, hazardous: 0 });

        const currentInvoicedKg = sumInvoicedKg(dedupedNormalizedInvoices);
        const previousInvoicedKg = sumInvoicedKg(dedupedNormalizedPrevInvoices);

        const invoiceKgAnalysis = {
            special_var: calcVariation(currentInvoicedKg.special, previousInvoicedKg.special),
            hazardous_var: calcVariation(currentInvoicedKg.hazardous, previousInvoicedKg.hazardous),
            current_special: currentInvoicedKg.special,
            current_hazardous: currentInvoicedKg.hazardous,
        };

        const getTopUnits = (wasteGroup) => {
            const totals = {};
            Object.entries(wasteGroup.byUnit.special || {}).forEach(([unit, subcats]) => {
                totals[unit] = (totals[unit] || 0) + Object.values(subcats).reduce((s, v) => s + v, 0);
            });
            Object.entries(wasteGroup.byUnit.hazardous || {}).forEach(([unit, subcats]) => {
                totals[unit] = (totals[unit] || 0) + Object.values(subcats).reduce((s, v) => s + v, 0);
            });
            return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 3).map(u => u[0]);
        };
        const getTopRsadUnits = (wasteGroup) => {
            return Object.entries(wasteGroup.byUnit.assimilable || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(u => u[0]);
        };

        const executiveSummaryData = {
            periodLabel: label, totalReas: periodTotals.special + periodTotals.hazardous, totalRsad: periodTotals.assimilable,
            totalReasPrevious: previousPeriodTotals.special + previousPeriodTotals.hazardous, totalRsadPrevious: previousPeriodTotals.assimilable,
            invoiceCount: dedupedNormalizedInvoices.length, invoicesTotal: costData.total,
            topReasUnits: getTopUnits(currentGroup),
            topRsadUnits: getTopRsadUnits(currentGroup),
            providers: Object.keys(costData.byProvider)
        };

        const monthlyAnnexData = processMonthlyAnnexData(yearlyWasteForAnnex);

        const specialSubcategoriesMonthly = {};
        const specialSubcategoryNames = Object.keys(window.APP_CONFIG.wasteTypeOptions.special_waste_categories);
        specialSubcategoryNames.forEach(cat => {
            specialSubcategoriesMonthly[cat] = Array(monthlyDataPackage.data.length).fill(0);
        });
        monthlyDataPackage.data.forEach((monthData, monthIndex) => {
            (monthData.special || []).forEach(record => {
                if (specialSubcategoriesMonthly[record.waste_type]) {
                    specialSubcategoriesMonthly[record.waste_type][monthIndex] += (parseFloat(record.weight_kg) || 0);
                }
            });
        });

        const rsadByUnitMonthly = {};
        const unitNames = unitsCache.map(u => u.name);
        unitNames.forEach(unit => {
            rsadByUnitMonthly[unit] = Array(monthlyDataPackage.data.length).fill(0);
        });

        monthlyDataPackage.data.forEach((monthData, monthIndex) => {
            (monthData.assimilable || []).forEach(record => {
                let unitName = null;
                if (record.units && record.units.name) {
                    unitName = record.units.name;
                } else if (record.unit_name) {
                    unitName = record.unit_name;
                }

                if (unitName && rsadByUnitMonthly[unitName] !== undefined) {
                    rsadByUnitMonthly[unitName][monthIndex] += (parseFloat(record.weight_kg) || 0);
                }
            });
        });

        const allSpecialSubcategories = new Set();
        (currentWaste.special || []).forEach(r => allSpecialSubcategories.add(r.waste_type));
        const allHazardousSubcategories = new Set();
        (currentWaste.hazardous || []).forEach(r => allHazardousSubcategories.add(r.waste_type));

        const recyclingTotals = (recyclingData || []).reduce((acc, record) => {
            const material = record.material_type;
            const weight = parseFloat(record.weight_kg) || 0;
            if (!acc[material]) {
                acc[material] = 0;
            }
            acc[material] += weight;
            return acc;
        }, {});

        // PROCESAMIENTO DE ANEXO ANUAL DE RECICLAJE Y CO2
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const recyclingMonthlyAnnex = monthNames.map(name => ({
            month: name,
            papel: 0,
            carton: 0,
            total: 0
        }));

        (recyclingYearlyData || []).forEach(record => {
            const date = new Date(record.date);
            const monthIndex = date.getUTCMonth();
            if (monthIndex >= 0 && monthIndex < 12) {
                const weight = parseFloat(record.weight_kg) || 0;
                const type = record.material_type ? record.material_type.toLowerCase() : '';
                
                if (type.includes('papel')) {
                    recyclingMonthlyAnnex[monthIndex].papel += weight;
                    recyclingMonthlyAnnex[monthIndex].total += weight;
                }
                else if (type.includes('cartón') || type.includes('carton')) {
                    recyclingMonthlyAnnex[monthIndex].carton += weight;
                    recyclingMonthlyAnnex[monthIndex].total += weight;
                }
            }
        });

        // CÁLCULO DE HUELLA DE CARBONO (FACTORES HUELLACHILE/DEFRA)
        // Factor Relleno Sanitario (Papel/Cartón): 1.164,39 kgCO2e/t
        // Factor Reciclaje (Papel/Cartón): 21,281 kgCO2e/t
        // Ahorro: (1164.39 - 21.281) / 1000 = 1.143109 kgCO2e/kg
        const savingsFactor = 1.1431;

        const totalPapelYearly = recyclingMonthlyAnnex.reduce((s, m) => s + m.papel, 0);
        const totalCartonYearly = recyclingMonthlyAnnex.reduce((s, m) => s + m.carton, 0);
        
        const co2Savings = {
            papel: totalPapelYearly * savingsFactor,
            carton: totalCartonYearly * savingsFactor,
            total: (totalPapelYearly + totalCartonYearly) * savingsFactor
        };

        return {
            periodLabel: label, currentPeriod, periodTotals, previousPeriodTotals, costData, logoBase64,
            invoicesData: dedupedNormalizedInvoices.sort((a, b) => new Date(b.billing_cycle_end) - new Date(a.billing_cycle_end)),
            monthlyAnnexData, executiveSummaryData,
            generalCategoryAnalysis,
            invoiceKgAnalysis,
            monthlyAnalysisData: monthlyAnalysis,
            specialByUnitWithSubcategories: currentGroup.byUnit.special,
            hazardousByUnitWithSubcategories: currentGroup.byUnit.hazardous,
            allSpecialSubcategories,
            allHazardousSubcategories,
            allSpecialSubcategoriesForReport: ['CORTO-PUNZANTES', 'CULTIVOS Y MUESTRAS ALMACENADAS', 'PATOLOGICOS', 'RESTOS DE ANIMALES', 'SANGRE Y PRODUCTOS DERIVADOS'],
            rsadByUnit: Object.entries(currentGroup.byUnit.assimilable || {})
                .map(([name, kg]) => ({ name, kg }))
                .filter(d => d.kg > 0)
                .sort((a, b) => b.kg - a.kg),
            specialSubcategories: Object.keys(window.APP_CONFIG.wasteTypeOptions.special_waste_categories).map(cat => ({
                category: cat,
                period: currentGroup.special[cat] || 0,
                previous: previousGroup.special[cat] || 0,
                variation: calcVariation(currentGroup.special[cat], previousGroup.special[cat])
            })).sort((a, b) => b.period - a.period),
            hazardousGenerated: Object.entries(currentGroup.hazardous).filter(([_, kg]) => kg > 0).map(([type, kg]) => ({ type, kg })).sort((a, b) => b.kg - a.kg),
            specialSubcategoriesMonthly,
            rsadByUnitMonthly,
            recyclingTotals,
            recyclingMonthlyAnnex,
            co2Savings
        };
    };

    const renderAdvancedReport = (data) => {
        const renderVar = (v, isGeneral = false) => {
            if (v === Infinity) return `<span style="color: #16a34a; white-space: nowrap; font-weight: bold;">(Nuevo)</span>`;
            if (!isFinite(v) || v === null || Math.abs(v) < 0.1) return `<span style="color: #6b7280;">(estable)</span>`;
            const color = v >= 0 ? '#dc2626' : '#16a34a';
            const icon = v >= 0 ? '▲' : '▼';
            const text = v >= 0 ? (isGeneral ? 'subió' : 'un alza de') : (isGeneral ? 'bajó' : 'una baja de');
            return `<span style="color: ${color}; white-space: nowrap;">${isGeneral ? text : ''} ${icon} ${Math.abs(v).toFixed(1)}%</span>`;
        };
        const formatCLP = (num) => `$${Math.round(num || 0).toLocaleString('es-CL')}`;
        const monthNamesFull = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        const logoHtml = `<img crossorigin="anonymous" src="${data.logoBase64}" alt="Logo del Hospital" style="height: 64px;">`;
        const coverLogoHtml = `<img crossorigin="anonymous" src="${data.logoBase64}" alt="Logo Hospital Penco Lirquén" style="height: 96px; margin: 0 auto;">`;

        const renderCategoryName = (cat) => {
            if (cat === 'special') return 'Residuos Especiales';
            if (cat === 'hazardous') return 'Residuos Peligrosos';
            if (cat === 'assimilable') return 'Residuos Asimilables a Domiciliario (RSAD)';
            return cat;
        };

        const coverPageHTML = `
        <div class="report-page" style="text-align: center; justify-content: space-between; page-break-after: always; position: relative;">
            <header style="padding-top: 2rem;">${coverLogoHtml}</header>
            <main style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center;">
                <h1 style="font-size: 2.5rem; font-weight: 700;">Informe de Gestión de la unidad de REAS</h1>
                <div style="margin-top: 3rem; max-width: 500px; margin-left: auto; margin-right: auto;">
                    <hr><p style="font-size: 1.25rem; color: #4b5563; text-align: center;"><span style="font-weight: 600;">Período:</span> ${data.periodLabel}</p><hr>
                </div>
            </main>
            
            <div style="margin-bottom: 3rem; display: flex; justify-content: flex-end; padding-right: 3rem;">
                <div style="text-align: center; width: 250px;">
                    <p style="margin-bottom: 5px;">_____________________________</p>
                    <p style="font-weight: bold; margin: 0; font-size: 1.1rem;">Patricia Paulos Villarreal</p>
                    <p style="margin: 0; font-size: 1rem;">Directora</p>
                    <p style="margin: 0; font-size: 0.9rem; color: #6b7280;">Hospital Penco Lirquén</p>
                </div>
            </div>

            <footer style="padding-bottom: 2rem; font-size: 0.875rem; color: #4b5563;">
                <p><strong>Elaborado por:</strong> Michael Cádiz Delgado, Encargado de REAS</p>
                <p><strong>Fecha de Emisión:</strong> ${new Date().toLocaleDateString('es-CL')}</p>
            </footer>
        </div>`;

        const summary = data.executiveSummaryData;
        const varReas = calcVariation(summary.totalReas, summary.totalReasPrevious);
        const varRsad = calcVariation(summary.totalRsad, summary.totalRsadPrevious);
        const varTotal = calcVariation(data.periodTotals.total, data.previousPeriodTotals.total);
        const getTrendText = (variation, type) => {
            if (variation === Infinity) return `se registró generación de ${type} por primera vez`;
            if (!isFinite(variation) || Math.abs(variation) < 5) return `se mantuvo relativamente estable en la generación de ${type}`;
            if (variation > 5) return `se observó un aumento significativo en la generación de ${type}`;
            return `se observó una disminución significativa en la generación de ${type}`;
        };
        
        const executiveSummaryHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Resumen Ejecutivo</h1></header>
            <main>
                <h3>I. Introducción y Alcance</h3>
                <p>El presente informe de gestión integral analiza la generación y manejo de Residuos Especiales, peligrosos y Residuos Sólidos Asimilables a Domiciliarios (RSAD) en el Hospital Penco Lirquén para el período <strong>${summary.periodLabel}</strong>. El objetivo es proporcionar una visión clara del desempeño, identificar tendencias, y fundamentar la toma de decisiones para la optimización de recursos y el cumplimiento normativo.</p>
                
                <h3>II. Indicadores Clave de Desempeño (KPIs)</h3>
                <table style="margin-top: 1rem;">
                    <thead><tr><th>Indicador</th><th class="text-right">Periodo Actual</th><th class="text-right">Periodo Anterior</th><th class="text-right">Variación</th></tr></thead>
                    <tbody>
                        <tr><td>Generación Total REAS (kg)</td><td class="text-right">${(Number(summary.totalReas) || 0).toFixed(1)}</td><td class="text-right">${(Number(summary.totalReasPrevious) || 0).toFixed(1)}</td><td class="text-right">${renderVar(varReas)}</td></tr>
                        <tr><td>Generación Total RSAD (kg)</td><td class="text-right">${(Number(summary.totalRsad) || 0).toFixed(1)}</td><td class="text-right">${(Number(summary.totalRsadPrevious) || 0).toFixed(1)}</td><td class="text-right">${renderVar(varRsad)}</td></tr>
                        <tr style="font-weight: bold; background-color: #f3f4f6;"><td>Generación General (kg)</td><td class="text-right">${(Number(data.periodTotals.total) || 0).toFixed(1)}</td><td class="text-right">${(Number(data.previousPeriodTotals.total) || 0).toFixed(1)}</td><td class="text-right">${renderVar(varTotal)}</td></tr>
                        <tr><td>Costo Total Facturado (OCs)</td><td class="text-right">${formatCLP(summary.invoicesTotal)}</td><td colspan="2" style="text-align: center; color: #6b7280;">N/A</td></tr>
                    </tbody>
                </table>

                <h3>III. Principales Hallazgos</h3>
                <ul style="list-style-type: disc; padding-left: 20px;">
                    <li>En el período, ${getTrendText(varTotal, 'residuos en general')}, con un total de <strong>${(Number(data.periodTotals.total) || 0).toFixed(1)} kg</strong>.</li>
                    <li>Las unidades que más contribuyeron a la generación de Residuos especiales y peligrosos fueron <strong>${summary.topReasUnits.join(', ')}</strong>. Para RSAD, las principales unidades fueron <strong>${summary.topRsadUnits.join(', ')}</strong>.</li>
                    <li>El costo total asociado al retiro de residuos, validado a través de <strong>${summary.invoiceCount} Órdenes de Compra</strong>, ascendió a <strong>${formatCLP(summary.invoicesTotal)}</strong>.</li>
                </ul>

                 <h3>IV. Conclusión General</h3>
                 <p>El período muestra una dinámica de generación de residuos que requiere monitoreo continuo. Las variaciones observadas son indicadores clave para enfocar los esfuerzos de capacitación y optimización. Se debe prestar especial atención a las unidades con mayor generación y a las subcategorías con cambios abruptos para asegurar una segregación correcta y un manejo eficiente de los recursos.</p>
            </main>
        </div>`;

        const generalAnalysisHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Análisis General de Categorías</h1></header>
            <main>
                ${data.generalCategoryAnalysis.map(analysis => `
                    <div style="margin-bottom: 2rem; page-break-inside: avoid;">
                        <h3>V. ${renderCategoryName(analysis.category)}</h3>
                        <p>Durante el período completo, la generación total de ${renderCategoryName(analysis.category)} fue de <strong>${analysis.totalPeriod.toFixed(1)} kg</strong>. En comparación con el período anterior, esto representa que la generación <strong>${renderVar(analysis.periodVariation, true)}</strong>.</p>
                        ${analysis.monthlyVariations.length > 0 ? `
                            <p>Al analizar la evolución mensual dentro del período:</p>
                            <ul style="list-style-type: disc; padding-left: 20px;">
                                ${analysis.monthlyVariations.map(variation => `
                                    <li>${variation.text} se observó ${renderVar(variation.variation, true)}.</li>
                                `).join('')}
                            </ul>` : ''
                    }
                    </div>
                `).join('')}
            </main>
        </div>`;

        const mainPieChartHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Composición General de Residuos</h1></header>
            <main>
                <h3>VI. Distribución General de Residuos (${data.periodLabel})</h3>
                <p class="text-xs" style="color: #6b7280;">Este gráfico muestra la proporción de cada categoría principal sobre el total de residuos generados durante el período.</p>
                <div class="chart-container" style="height: 500px; margin-top: 2rem;"><canvas id="report-main-composition-chart"></canvas></div>
            </main>
        </div>`;

        const specialAnalysisHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Análisis Detallado: Residuos Especiales</h1></header>
            <main>
                <h3>VII. Análisis de Subcategorías de Residuos Especiales</h3>
                <p>A continuación, se detalla la generación mensual por subcategoría, mostrando los kilos generados y su variación porcentual respecto al mes anterior.</p>
                <table style="margin-top: 1rem;">
                    <thead>
                        <tr>
                            <th style="text-align: left;">Subcategoría</th>
                            ${data.monthlyAnalysisData.map(m => `<th class="text-right">${m.label}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(data.specialSubcategoriesMonthly).map(([cat, monthlyValues]) => `
                            <tr>
                                <td>${cat}</td>
                                ${monthlyValues.map((kg, index) => {
            const prevKg = index > 0 ? monthlyValues[index - 1] : 0;
            const variationHTML = (index > 0 && (kg > 0 || prevKg > 0)) ? renderVar(calcVariation(kg, prevKg)) : '';
            return `<td class="text-right" style="white-space: nowrap;">${kg.toFixed(1)} kg <span style="font-size: 0.8em;">${variationHTML}</span></td>`;
        }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </main>
        </div>`;

        const specialByUnitHTML = () => {
            return `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Análisis por Unidad: Residuos Especiales</h1></header>
            <main>
                <h3>VIII. Generación de Residuos Especiales por Unidad y Subcategoría</h3>
                <p class="text-xs" style="color: #6b7280;">El gráfico de barras apiladas muestra las unidades con mayor generación de residuos especiales (en kg), desglosando la contribución de las 5 subcategorías principales.</p>
                <div class="chart-container" style="height: 600px;"><canvas id="report-special-by-unit-chart"></canvas></div>
            </main>
        </div>`;
        };

        const hazardousAnalysisHTML = `
         <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Análisis Detallado: Residuos Peligrosos</h1></header>
            <main>
                <h3>IX. Residuos Peligrosos Generados en el Período</h3>
                <p>Se generó un total de <strong>${data.periodTotals.hazardous.toFixed(1)} kg</strong> de residuos peligrosos. A continuación se listan los tipos de residuos y sus cantidades.</p>
                <table style="margin-top: 1rem;">
                    <thead><tr><th>Tipo de Residuo Peligroso</th><th class="text-right">Cantidad (kg)</th></tr></thead>
                    <tbody>
                        ${data.hazardousGenerated.length > 0 ? data.hazardousGenerated.map(h => `<tr><td>${h.type}</td><td class="text-right">${h.kg.toFixed(2)}</td></tr>`).join('') : `<tr><td colspan="2" class="text-center">No se generaron residuos peligrosos en este período.</td></tr>`}
                    </tbody>
                </table>
            </main>
        </div>`;

        const hazardousBarChartHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Análisis por Unidad: Residuos Peligrosos</h1></header>
            <main>
                <h3>X. Generación de Residuos Peligrosos por Unidad y Subcategoría</h3>
                <p class="text-xs" style="color: #6b7280;">El gráfico de barras apiladas clasifica las unidades según la cantidad de residuos peligrosos (en kg), desglosando la contribución de cada subcategoría.</p>
                <div class="chart-container" style="height: 600px;"><canvas id="report-hazardous-by-unit-chart"></canvas></div>
            </main>
        </div>`;

        const rsadAnalysisHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Análisis Detallado: RSAD</h1></header>
            <main>
                <h3>XI. Análisis de Residuos Asimilables a Domiciliario</h3>
                <p>La generación de RSAD en el período fue de <strong>${data.periodTotals.assimilable.toFixed(1)} kg</strong>. La siguiente tabla muestra la generación mensual por unidad de servicio, permitiendo identificar las áreas con mayor generación de residuos comunes y su evolución.</p>
                 <table style="margin-top: 1rem;">
                    <thead>
                        <tr>
                            <th style="text-align: left;">Unidad de Servicio</th>
                            ${data.monthlyAnalysisData.map(m => `<th class="text-right">${m.label}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(data.rsadByUnitMonthly)
                .filter(([_, values]) => values.reduce((s, v) => s + v, 0) > 0)
                .sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0))
                .map(([unit, monthlyValues]) => `
                            <tr>
                                <td>${unit}</td>
                                ${monthlyValues.map((kg, index) => {
                    const prevKg = index > 0 ? monthlyValues[index - 1] : 0;
                    const variationHTML = (index > 0 && (kg > 0 || prevKg > 0)) ? renderVar(calcVariation(kg, prevKg)) : '';
                    return `<td class="text-right" style="white-space: nowrap;">${kg.toFixed(1)} kg <span style="font-size: 0.8em;">${variationHTML}</span></td>`;
                }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </main>
        </div>`;

        const rsadBarChartHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Análisis por Unidad: RSAD</h1></header>
            <main>
                <h3>XII. Generación de RSAD por Unidad de Servicio</h3>
                <p class="text-xs" style="color: #6b7280;">El gráfico muestra la contribución en kg de cada unidad a la generación total de RSAD.</p>
                <div class="chart-container" style="height: 600px;"><canvas id="report-rsad-by-unit-chart"></canvas></div>
            </main>
        </div>`;

        const recyclingAnalysisHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Gestión de Reciclaje y Sostenibilidad</h1></header>
            <main>
                <h3>XIII. Evolución del Reciclaje y Huella de Carbono</h3>
                <p>El compromiso del Hospital con la sostenibilidad se refleja en la gestión de residuos reciclables. A continuación se presenta la evolución anual de segregación de Papel y Cartón.</p>
                
                <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 1rem; margin-bottom: 1.5rem; margin-top: 1rem;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #166534; font-size: 1.1rem;">Impacto Ambiental Positivo</h4>
                    <p style="margin: 0; font-size: 0.95rem; color: #14532d;">
                        Gracias al reciclaje de <strong>${data.recyclingMonthlyAnnex.reduce((s,m)=>s+m.total,0).toFixed(1)} kg</strong> de material en lo que va del año, 
                        se estima que el establecimiento ha evitado la emisión de aproximadamente 
                        <strong>${data.co2Savings.total.toFixed(1)} kg de CO2 equivalente</strong> a la atmósfera.
                    </p>
                    <p style="margin-top: 5px; font-size: 0.75rem; color: #6b7280;">*Estimación basada en factores de emisión HuellaChile/DEFRA 2023: Ahorro de ~1.14 kgCO2e por kg reciclado (vs. Relleno Sanitario).</p>
                </div>

                <p class="text-xs" style="color: #6b7280;">El siguiente gráfico lineal muestra la tendencia mensual de recuperación de Papeles y Cartones.</p>
                <div class="chart-container" style="height: 450px;"><canvas id="report-recycling-line-chart"></canvas></div>
            </main>
        </div>`;

        const financialAnalysisText = () => {
            const { special_var, hazardous_var, current_special, current_hazardous } = data.invoiceKgAnalysis;
            let text = `Durante este período, se facturó un total de <strong>${current_special.toFixed(1)} kg</strong> de residuos especiales y <strong>${current_hazardous.toFixed(1)} kg</strong> de residuos peligrosos.`;

            const specialText = isFinite(special_var) ? ` En comparación con el período anterior, los kilogramos de residuos especiales facturados ${renderVar(special_var, true)}.` : '';
            const hazardousText = isFinite(hazardous_var) ? ` Por su parte, los residuos peligrosos facturados ${renderVar(hazardous_var, true)}.` : '';

            return `<p>${text}${specialText}${hazardousText}</p>`;
        };

        const financialPageHTML = `
        <div class="report-page" style="page-break-after: always; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
                <header class="report-header">${logoHtml}<h1>Análisis Financiero</h1></header>
                <main>
                    <section>
                        <h3>XIV. Órdenes de Compra (OC) Registradas en Período</h3>
                        ${financialAnalysisText()}
                        <p class="text-xs mt-2" style="color: #6b7280;">A continuación, se detallan las OCs cuyos ciclos de facturación corresponden a los meses del período analizado.</p>
                        <table style="margin-top: 1rem;">
                            <thead><tr><th>N° OC</th><th>Proveedor</th><th>Periodo Facturado</th><th class="text-right">Monto (IVA Incl.)</th><th>Estado</th></tr></thead>
                            <tbody>
                                ${(data.invoicesData && data.invoicesData.length > 0) ? data.invoicesData.map(inv => {
            const endDate = new Date(inv.billing_cycle_end + 'T00:00:00');
            const periodLabel = `${monthNamesFull[endDate.getUTCMonth()]} ${endDate.getUTCFullYear()}`;
            return `<tr><td>${inv.purchase_order_number}</td><td>${inv.agreement_name || 'N/A'}</td><td>${periodLabel}</td><td class="text-right">${formatCLP(inv.pre_invoice_amount_iva)}</td><td>${inv.status}</td></tr>`;
        }).join('') : `<tr><td colspan="5" style="text-align: center;">No hay OCs para este período.</td></tr>`}
                            </tbody>
                            <tfoot><tr style="font-weight: bold; background-color: #f3f4f6;"><td colspan="3">Total Facturado en OCs</td><td class="text-right">${formatCLP(data.executiveSummaryData.invoicesTotal)}</td><td></td></tr></tfoot>
                        </table>
                    </section>
                </main>
            </div>
            <footer style="text-align: right; padding-top: 4rem;">
                <div style="display: inline-block; text-align: center; border-top: 1px solid #374151; padding-top: 8px; width: 250px;">
                    <p style="font-size: 0.8rem; color: #374151; line-height: 1.2;">Michael Cádiz Delgado</p>
                    <p style="font-size: 0.7rem; color: #6b7280; line-height: 1.2;">Encargado de REAS</p>
                    <p style="font-size: 0.7rem; color: #6b7280; line-height: 1.2;">Hospital Penco Lirquén</p>
                </div>
            </footer>
        </div>`;

        const annexAPageHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Anexo A</h1></header>
            <main>
                <section>
                    <h3>Anexo A: Generación Mensual de Residuos (Año Completo)</h3>
                    <table style="margin-top: 1rem;">
                        <thead><tr><th>Mes</th><th class="text-right">Peligrosos (kg)</th><th class="text-right">Especiales (kg)</th><th class="text-right">Asimilables (kg)</th><th class="text-right">Total (kg)</th></tr></thead>
                        <tbody>${data.monthlyAnnexData.map(m => {
            const hazardousVal = (typeof m.hazardous === 'number' ? m.hazardous : (parseFloat(m.hazardous) || 0));
            const specialVal = (typeof m.special === 'number' ? m.special : (parseFloat(m.special) || 0));
            const assimilableVal = (typeof m.assimilable === 'number' ? m.assimilable : (parseFloat(m.assimilable) || 0));
            const totalVal = (typeof m.total === 'number' ? m.total : (parseFloat(m.total) || 0));
            return `<tr><td>${m.month}</td><td class="text-right">${hazardousVal.toFixed(1)}</td><td class="text-right">${specialVal.toFixed(1)}</td><td class="text-right">${assimilableVal.toFixed(1)}</td><td class="text-right" style="font-weight: bold;">${totalVal.toFixed(1)}</td></tr>`;
        }).join('')}</tbody>
                        <tfoot>
                            <tr style="font-weight: bold; background-color: #f3f4f6;">
                                <td>Total Anual</td>
                                <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + (typeof m.hazardous === 'number' ? m.hazardous : (parseFloat(m.hazardous) || 0)), 0).toFixed(1)}</td>
                                <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + (typeof m.special === 'number' ? m.special : (parseFloat(m.special) || 0)), 0).toFixed(1)}</td>
                                <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + (typeof m.assimilable === 'number' ? m.assimilable : (parseFloat(m.assimilable) || 0)), 0).toFixed(1)}</td>
                                <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + (typeof m.total === 'number' ? m.total : (parseFloat(m.total) || 0)), 0).toFixed(1)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </section>
            </main>
        </div>`;

        const annexBPageHTML = `
            <div class="report-page" style="page-break-after: always;">
                <header class="report-header">${logoHtml}<h1>Anexo B</h1></header>
                <main>
                    <section>
                        <h3>Anexo B: Detalle de Órdenes de Compra</h3>
                        <p class="text-xs" style="color: #6b7280;">Se detallan las OCs cuyos ciclos de facturación corresponden a los meses del período analizado.</p>
                        <table style="margin-top: 1rem;">
                           <thead>
                                <tr>
                                    <th>N° Orden de Compra</th>
                                    <th>Convenio</th>
                                    <th>Inicio Ciclo</th>
                                    <th>Fin Ciclo</th>
                                    <th class="text-right">Kg Especial Prefactura</th>
                                    <th class="text-right">Kg Peligroso Prefactura</th>
                                    <th class="text-right">Valor Prefactura (IVA incl.)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(data.invoicesData && data.invoicesData.length > 0) ? data.invoicesData.map(inv => `
                                    <tr>
                                        <td>${inv.purchase_order_number}</td>
                                        <td>${inv.agreement_name || 'N/A'}</td>
                                        <td>${new Date(inv.billing_cycle_start + 'T00:00:00').toLocaleDateString('es-CL')}</td>
                                        <td>${new Date(inv.billing_cycle_end + 'T00:00:00').toLocaleDateString('es-CL')}</td>
                                        <td class="text-right">${(inv.pre_invoice_kg_special || 0).toFixed(1)}</td>
                                        <td class="text-right">${(inv.pre_invoice_kg_hazardous || 0).toFixed(1)}</td>
                                        <td class="text-right">${formatCLP(inv.pre_invoice_amount_iva)}</td>
                                    </tr>
                                `).join('') : `<tr><td colspan="7" style="text-align: center;">No hay OCs para este período.</td></tr>`}
                            </tbody>
                        </table>
                    </section>
                </main>
            </div>`;

        const annexDPageHTML = `
        <div class="report-page" style="page-break-after: always;">
            <header class="report-header">${logoHtml}<h1>Anexo D: Reciclaje Anual</h1></header>
            <main>
                <h3>Anexo D: Registro Mensual de Reciclaje (Año Completo)</h3>
                <p class="text-xs" style="color: #6b7280;">Detalle consolidado de materiales reciclados mes a mes durante el presente año.</p>
                <table style="margin-top: 1rem;">
                    <thead>
                        <tr>
                            <th>Mes</th>
                            <th class="text-right">Papel (kg)</th>
                            <th class="text-right">Cartón (kg)</th>
                            <th class="text-right" style="background-color: #ecfdf5;">Total Mes (kg)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.recyclingMonthlyAnnex.map(m => `
                        <tr>
                            <td>${m.month}</td>
                            <td class="text-right">${m.papel > 0 ? m.papel.toFixed(1) : '-'}</td>
                            <td class="text-right">${m.carton > 0 ? m.carton.toFixed(1) : '-'}</td>
                            <td class="text-right font-bold" style="background-color: #f0fdf4;">${m.total.toFixed(1)}</td>
                        </tr>`).join('')}
                    </tbody>
                    <tfoot>
                        <tr style="font-weight: bold; background-color: #d1fae5; border-top: 2px solid #10b981;">
                            <td>TOTAL ANUAL</td>
                            <td class="text-right">${data.recyclingMonthlyAnnex.reduce((s,m)=>s+m.papel,0).toFixed(1)}</td>
                            <td class="text-right">${data.recyclingMonthlyAnnex.reduce((s,m)=>s+m.carton,0).toFixed(1)}</td>
                            <td class="text-right">${data.recyclingMonthlyAnnex.reduce((s,m)=>s+m.total,0).toFixed(1)}</td>
                        </tr>
                    </tfoot>
                </table>
            </main>
        </div>`;

        const reportStyles = `
        <style>
            /* Inter Font - Local Version */
            /* Se utilizan rutas relativas (sin / al inicio) para mayor compatibilidad con subcarpetas */
            
            @font-face {
                font-family: 'Inter';
                font-style: normal;
                font-weight: 400;
                font-display: swap;
                src: url('libs/fonts/inter/inter-regular.woff2') format('woff2');
            }
            
            @font-face {
                font-family: 'Inter';
                font-style: normal;
                font-weight: 500;
                font-display: swap;
                src: url('libs/fonts/inter/inter-500.woff2') format('woff2');
            }
            
            @font-face {
                font-family: 'Inter';
                font-style: normal;
                font-weight: 600;
                font-display: swap;
                src: url('libs/fonts/inter/inter-600.woff2') format('woff2');
            }
            
            @font-face {
                font-family: 'Inter';
                font-style: normal;
                font-weight: 700;
                font-display: swap;
                src: url('libs/fonts/inter/inter-700.woff2') format('woff2');
            }
            
            .report-page {
                font-family: 'Inter', 'Calibri', sans-serif; background: white; width: 21.59cm; min-height: 27.94cm; padding: 1.2cm; margin: 1rem auto;
                box-shadow: 0 0 10px rgba(0,0,0,0.1); box-sizing: border-box; display: flex; flex-direction: column;
            }
            .report-header { display: flex; align-items: center; border-bottom: 2px solid #d1d5db; padding-bottom: 1rem; margin-bottom: 1.5rem; }
            .report-header h1 { font-size: 1.5rem; font-weight: 700; color: #1f2937; margin-left: 1.5rem; }
            h3 { font-size: 1.2rem; font-weight: 700; color: #111827; margin-top: 1.5rem; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #eef2ff; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; page-break-inside: avoid; font-size: 0.75rem; }
            th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; }
            th { background-color: #f3f4f6; font-weight: 600; }
            td.text-right, th.text-right { text-align: right; }
            .chart-container { padding: 0.5rem; border: 1px solid #e5e7eb; border-radius: 0.375rem; margin-top: 1rem; margin-bottom: 1rem; page-break-inside: avoid; }
        </style>`;

        return reportStyles + 
               coverPageHTML + 
               executiveSummaryHTML + 
               generalAnalysisHTML + 
               mainPieChartHTML + 
               specialAnalysisHTML +
               specialByUnitHTML() + 
               hazardousAnalysisHTML +
               hazardousBarChartHTML + 
               rsadAnalysisHTML + 
               rsadBarChartHTML + 
               recyclingAnalysisHTML +
               financialPageHTML + 
               annexAPageHTML + 
               annexBPageHTML + 
               annexDPageHTML;
    };

    // -----------------------------------------------------------------------------
    // 5. GRÁFICOS DE DASHBOARD (PANTALLA)
    // -----------------------------------------------------------------------------
    const renderReportCharts = (data) => {
        const chartDefaultOptions = (titleText) => ({
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { font: { size: 9 }, boxWidth: 15 } },
                title: { display: true, text: titleText, font: { size: 11, weight: 'bold' } },
                datalabels: { display: false }
            },
            scales: {
                y: { ticks: { font: { size: 8 } } },
                x: { ticks: { font: { size: 8 } } }
            }
        });

        const prepareStackedChartData = (dataByUnit, allSubcategoriesSet, colorPalette) => {
            const subcatArray = Array.from(allSubcategoriesSet).sort();
            const sortedUnits = Object.entries(dataByUnit).map(([unitName, subcategories]) => {
                const filteredSubcategories = {};
                let total = 0;
                subcatArray.forEach(subcat => {
                    if (subcategories[subcat]) {
                        filteredSubcategories[subcat] = subcategories[subcat];
                        total += subcategories[subcat];
                    }
                });
                return { name: unitName, total: total, subcategories: filteredSubcategories }
            }).filter(u => u.total > 0).sort((a, b) => b.total - a.total).slice(0, 25);

            const labels = sortedUnits.map(u => u.name);
            const datasets = subcatArray.map((subcat, i) => ({
                label: subcat,
                data: sortedUnits.map(u => u.subcategories[subcat] || 0),
                backgroundColor: colorPalette[i % colorPalette.length]
            }));
            return { labels, datasets };
        };

        if (document.getElementById('report-main-composition-chart')) {
            new Chart(document.getElementById('report-main-composition-chart').getContext('2d'), {
                type: 'pie',
                data: {
                    labels: ['Especiales', 'Peligrosos', 'Asimilables'],
                    datasets: [{
                        data: [data.periodTotals.special, data.periodTotals.hazardous, data.periodTotals.assimilable],
                        backgroundColor: ['#f59e0b', '#ef4444', '#22c55e']
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        title: { display: false }, datalabels: { display: false },
                        legend: { position: 'bottom', labels: { font: { size: 10 } } }
                    }
                }
            });
        }

        if (document.getElementById('report-special-by-unit-chart')) {
            const specialColorPalette = ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff'];
            const { labels, datasets } = prepareStackedChartData(data.specialByUnitWithSubcategories, data.allSpecialSubcategories, specialColorPalette);
            new Chart(document.getElementById('report-special-by-unit-chart').getContext('2d'), {
                type: 'bar',
                data: { labels, datasets },
                options: { ...chartDefaultOptions('Generación de Residuos Especiales por Unidad (kg)'), indexAxis: 'y', scales: { x: { stacked: true }, y: { stacked: true, ticks: { font: { size: 7 } } } } }
            });
        }

        if (document.getElementById('report-hazardous-by-unit-chart')) {
            const hazardousColorPalette = ['#ef4444', '#f87171', '#fb923c', '#fdba74', '#fecaca'];
            const { labels, datasets } = prepareStackedChartData(data.hazardousByUnitWithSubcategories, data.allHazardousSubcategories, hazardousColorPalette);
            new Chart(document.getElementById('report-hazardous-by-unit-chart').getContext('2d'), {
                type: 'bar',
                data: { labels, datasets },
                options: { ...chartDefaultOptions('Generación de Residuos Peligrosos por Unidad (kg)'), indexAxis: 'y', scales: { x: { stacked: true }, y: { stacked: true, ticks: { font: { size: 7 } } } } }
            });
        }

        if (document.getElementById('report-rsad-by-unit-chart')) {
            const chartData = {
                labels: data.rsadByUnit.map(d => d.name),
                datasets: [{ label: 'Kg', data: data.rsadByUnit.map(d => d.kg), backgroundColor: '#22c55e' }]
            };
            new Chart(document.getElementById('report-rsad-by-unit-chart').getContext('2d'), {
                type: 'bar',
                data: chartData,
                options: {
                    ...chartDefaultOptions('Generación de RSAD por Unidad (kg)'),
                    indexAxis: 'y',
                    plugins: { legend: { display: false }, datalabels: { display: true, anchor: 'end', align: 'end', formatter: (value) => value.toFixed(1) } },
                    scales: { x: { title: { display: true, text: 'Peso (kg)' } }, y: { ticks: { autoSkip: false }, afterFit: (scale) => { scale.width = 200; } } },
                    layout: { padding: { right: 50 } }
                }
            });
        }

        if (document.getElementById('report-recycling-line-chart')) {
            const recyclingLabels = data.recyclingMonthlyAnnex.map(m => m.month);
            const paperData = data.recyclingMonthlyAnnex.map(m => m.papel);
            const cardboardData = data.recyclingMonthlyAnnex.map(m => m.carton);

            new Chart(document.getElementById('report-recycling-line-chart').getContext('2d'), {
                type: 'line',
                data: {
                    labels: recyclingLabels,
                    datasets: [
                        {
                            label: 'Papel (kg)',
                            data: paperData,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 3
                        },
                        {
                            label: 'Cartón (kg)',
                            data: cardboardData,
                            borderColor: '#a16207',
                            backgroundColor: 'rgba(161, 98, 7, 0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 3
                        }
                    ]
                },
                options: {
                    ...chartDefaultOptions('Tendencia Mensual de Reciclaje (kg)'),
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'Peso (kg)', font: { size: 9 } }
                        },
                        x: {
                            grid: { display: false }
                        }
                    },
                    plugins: {
                        ...chartDefaultOptions('').plugins,
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                        }
                    }
                }
            });
        }
    };

    return { init, loadDashboardData };
})();
// =================================================================================
// FIN: MÓDULO DE DASHBOARD
// =================================================================================
// =================================================================================
// INICIO: MÓDULO BI ESTADÍSTICAS V29.1 (CORREGIDO: DESGLOSE COMPLETO RSAD/SUBS)
// =================================================================================
window.APP_MODULES.estadisticas = (() => {
    // --- VARIABLES DE ESTADO ---
    let dynamicChart = null, trendChart = null, logisticsChart = null, capacityChart = null, comparisonChart = null, varianceChart = null;
    
    let reportState = {
        data: [], data2: [], pickups: [], containers: [], recycling: [], agreements: [],
        viewMode: 'cost', tableViewMode: 'building', filterUnit: null,
        dateRange: { start: null, end: null, days: 1 },
        periodLabels: { p1: 'Periodo 1', p2: 'Periodo 2' }
    };

    // --- 1. INGENIERÍA DE RESIDUOS (DENSIDAD & CO2 DETALLADO) ---
    const ENGINEERING_MAP = [
        // ALTO IMPACTO / GASES
        { keywords: ['INHALADOR', 'AEROSOL', 'PUFF'], density: 0.15, co2Factor: 25.0, name: 'Inhaladores (Gases)' },
        { keywords: ['GAS', 'CILINDRO', 'OXIDO', 'PROPANO'], density: 0.20, co2Factor: 5.0, name: 'Cilindros/Gases' },

        // QUÍMICOS Y FARMACÉUTICOS
        { keywords: ['FORMALINA', 'FORMALDEHIDO'], density: 1.09, co2Factor: 1.90, name: 'Formalina' },
        { keywords: ['XILOL', 'XILENO', 'SOLVENTE', 'LIQUIDO REVELADOR'], density: 0.86, co2Factor: 2.10, name: 'Xilol/Solventes' },
        { keywords: ['CITOTOXICO', 'CITOSTATICO', 'DROGA'], density: 1.02, co2Factor: 2.50, name: 'Citotóxicos' },
        { keywords: ['MEDICAMENTO', 'VENCIDO', 'FARMACO', 'JARABE', 'COMPRIMIDO'], density: 0.50, co2Factor: 1.80, name: 'Medicamentos' },
        { keywords: ['CAL', 'SODADA'], density: 0.80, co2Factor: 0.50, name: 'Cal Sodada' },
        { keywords: ['ALCOHOL', 'ETANOL', 'GEL'], density: 0.79, co2Factor: 1.80, name: 'Alcoholes' },
        { keywords: ['ACIDO', 'CLORHIDRICO', 'SULFURICO'], density: 1.20, co2Factor: 1.50, name: 'Ácidos' },
        { keywords: ['MERCURIO', 'TERMOMETRO', 'AMALGAMA'], density: 13.5, co2Factor: 0.1, name: 'Mercurio' },
        { keywords: ['YODO', 'POVIDONA'], density: 1.0, co2Factor: 1.2, name: 'Yodados' },

        // BIOLÓGICOS / SANITARIOS (REAS)
        { keywords: ['SANGRE', 'FLUIDO', 'HEMODERIVADO', 'PLASMA'], density: 1.06, co2Factor: 0.30, name: 'Sangre/Fluidos' },
        { keywords: ['PATOLOGICO', 'PLACENTA', 'TEJIDO', 'PIEZA ANATOMICA', 'BIOPSIA'], density: 0.95, co2Factor: 0.40, name: 'Patológicos' },
        { keywords: ['CULTIVO', 'CEPA', 'BIOLOGICO', 'PLACA', 'PETRI'], density: 0.80, co2Factor: 0.40, name: 'Cultivos/Cepas' },
        { keywords: ['ANIMAL', 'RESTOS'], density: 0.90, co2Factor: 0.40, name: 'Animales' },
        
        // MATERIAL MÉDICO E INSUMOS
        { keywords: ['CORTOPUNZANTE', 'AGUJA', 'BISTURI', 'CORTO', 'PUNZANTE', 'LANCETA'], density: 0.35, co2Factor: 1.50, name: 'Cortopunzantes' },
        { keywords: ['AMPOLLA', 'VIDRIO', 'FRASCO'], density: 0.45, co2Factor: 0.20, name: 'Vidrio Contaminado' },
        { keywords: ['APOSITO', 'GASA', 'ALGODON', 'PAÑAL', 'EPP', 'GUANTE', 'MASCARILLA', 'CONTAMINADO'], density: 0.12, co2Factor: 1.20, name: 'Insumos Contaminados' },

        // INDUSTRIAL / BATERÍAS
        { keywords: ['PLOMO', 'BATERIA', 'PLACAS', 'ACUMULADOR'], density: 11.3, co2Factor: 0.50, name: 'Baterías Plomo' },
        { keywords: ['PILA', 'NIQUEL', 'LITIO', 'ALCALINA'], density: 2.50, co2Factor: 2.00, name: 'Pilas' },
        { keywords: ['TONER', 'CARTUCHO', 'TINTA'], density: 0.60, co2Factor: 1.50, name: 'Toner' },
        { keywords: ['ELECTRONICO', 'CABLE', 'RAEE'], density: 0.40, co2Factor: 1.0, name: 'Residuos Electrónicos' }
    ];
    
    // Configuración Base
    const DEFAULT_PROPS = { density: 0.22, co2Factor: 0.5, name: 'Otros Residuos' };
    const RSAD_PROPS = { density: 0.25, co2Factor: 1.1, name: 'RSAD (Doméstico)' }; 
    const SAFETY_FILL_FACTOR = 0.75; // Normativa: 75% máximo

    const wasteTypeStyles = {
        hazardous_waste: { label: 'Peligroso', chartColor: '#ef4444', textColor: 'text-red-600', borderColor: 'border-red-500' },
        special_waste: { label: 'Especial', chartColor: '#f59e0b', textColor: 'text-amber-600', borderColor: 'border-amber-500' },
        assimilable_waste: { label: 'RSAD', chartColor: '#22c55e', textColor: 'text-green-600', borderColor: 'border-green-500' }
    };

    // --- 2. LOGÍSTICA DE TRANSPORTE (Regla 120L vs 240L) ---
    function getContainerSizeRule(unitName) {
        if (!unitName) return 120;
        const n = unitName.toUpperCase();
        if (n.includes('QUIRURGICO') || n.includes('PABELLON') || n.includes('ABASTECIMIENTO') || n.includes('ESTERILIZACION')) {
            return 240;
        }
        return 120; // Estándar general carro transporte
    }

    // --- HELPERS ---
    function getWasteProperties(description, mainType) {
        if (mainType === 'assimilable_waste') return RSAD_PROPS;
        if (!description) return DEFAULT_PROPS;
        const descUpper = description.toUpperCase();
        const match = ENGINEERING_MAP.find(m => m.keywords.some(k => descUpper.includes(k)));
        return match ? { ...match } : { ...DEFAULT_PROPS, name: description.substring(0, 25) };
    }

    function getPriceForRecord(recordDateString, wasteType) {
        const dateStr = recordDateString.includes('T') ? recordDateString.split('T')[0] : recordDateString;
        const rDate = new Date(dateStr + "T12:00:00"); 
        const activeAgreement = reportState.agreements.find(a => {
            const start = new Date(a.start_date + "T00:00:00");
            const end = new Date(a.end_date + "T23:59:59");
            return rDate >= start && rDate <= end;
        });
        if (!activeAgreement) return 0;
        if (wasteType === 'hazardous_waste') return parseFloat(activeAgreement.price_hazardous) || 0;
        if (wasteType === 'special_waste') return parseFloat(activeAgreement.price_special) || 0;
        return 0; 
    }

    function formatValue(value) {
        if (reportState.viewMode === 'cost') return '$ ' + Math.round(value).toLocaleString('es-CL');
        return parseFloat(value).toFixed(1) + ' kg';
    }

    function getVal(o) { return reportState.viewMode === 'weight' ? (o.w || 0) : (o.c || 0); }
    function getValType(o, t) { return (o && o.types && o.types[t]) ? (reportState.viewMode === 'weight' ? o.types[t].w : o.types[t].c) : 0; }
    function calcVar(a, b) { if (!b && !a) return 0; if (!b) return 100; return ((a - b) / b) * 100; }

    function getUnitLocation(unitId) {
        const unit = unitsCache.find(u => u.id == unitId);
        if (!unit) return { building: 'Sin Edificio', floor: 'General', name: 'Desconocida' };
        if (unit.building && unit.floor) return { building: unit.building, floor: unit.floor, name: unit.name };
        const nameParts = unit.name.split('-');
        if (nameParts.length >= 2) {
            const potentialBuilding = nameParts[0].trim();
            const potentialFloor = nameParts.find(p => p.toLowerCase().includes('piso')) || 'General';
            const cleanName = unit.name.replace(potentialBuilding, '').replace(potentialFloor, '').replace(/^-+|-+$/g, '').trim();
            return { building: potentialBuilding || "Edificio Principal", floor: potentialFloor.trim(), name: cleanName || unit.name };
        }
        return { building: "Edificio Principal", floor: "General", name: unit.name };
    }

    function getReadableDateLabel(start, end) {
        if (!start || !end) return '-';
        const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate()===1 && e.getDate()>=28) return `${months[s.getMonth()]} ${s.getFullYear()}`;
        return `${s.getDate()}/${months[s.getMonth()]} - ${e.getDate()}/${months[e.getMonth()]} ${s.getFullYear()}`;
    }

    // --- INIT ---
    function init(container) {
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
        
        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div class="lg:col-span-3">
                    <div class="sticky top-6 space-y-4 z-20">
                        <div class="section-card p-4 border-l-4 border-emerald-500 shadow-sm">
                            <div class="flex justify-between items-center border-b pb-2 mb-3"><h2 class="text-sm font-bold text-emerald-800 uppercase">Contratos Vigentes</h2><i class="fas fa-file-contract text-emerald-600"></i></div>
                            <div id="agreements-status" class="text-xs text-gray-600 space-y-2 min-h-[50px]"><div class="flex items-center text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i> Cargando...</div></div>
                        </div>
                        <div class="section-card p-4 space-y-4 shadow-sm">
                            <div class="flex justify-between items-center border-b pb-2"><h2 class="text-lg font-semibold text-gray-800">Filtros</h2><i class="fas fa-filter text-indigo-500"></i></div>
                            <div class="bg-gray-100 p-1 rounded-lg flex">
                                <button id="mode-kg" class="flex-1 py-1 text-xs font-bold rounded text-gray-500 hover:bg-white transition-all">KILOS (kg)</button>
                                <button id="mode-cost" class="flex-1 py-1 text-xs font-bold rounded bg-emerald-600 text-white shadow transition-all">COSTOS ($)</button>
                            </div>
                            <div class="space-y-3">
                                <label class="flex items-center space-x-2 cursor-pointer"><input type="checkbox" id="compare-toggle" class="form-checkbox text-indigo-600 rounded"><span class="font-bold text-xs text-indigo-800 uppercase">Comparar Periodos</span></label>
                                <select id="quick-compare-select" class="form-input text-xs w-full mb-2"><option value="year_to_date" selected>Año actual</option><option value="month_vs_prev">Mes Actual vs Anterior</option><option value="custom">Personalizado</option></select>
                                <div><label class="text-xs text-gray-500 font-semibold block mb-1">Rango Principal</label><div class="grid grid-cols-2 gap-1"><input type="date" id="start-date-filter" value="${firstDayOfYear}" class="form-input text-xs"><input type="date" id="end-date-filter" value="${today}" class="form-input text-xs"></div></div>
                                <div id="compare-fields" class="hidden border-t pt-2"><label class="text-xs text-gray-500 font-semibold block mb-1">Rango Comparativo</label><div class="grid grid-cols-2 gap-1"><input type="date" id="start-date-filter-2" class="form-input text-xs"><input type="date" id="end-date-filter-2" class="form-input text-xs"></div></div>
                            </div>
                            <div><label class="font-semibold text-sm text-gray-600 block mb-2">Tipos de Residuo</label><div id="waste-type-toggles" class="space-y-1"></div></div>
                            <div><label class="font-semibold text-sm text-gray-600 block mb-1">Unidades</label><select id="units-filter" class="form-input text-xs w-full" multiple style="height: 80px;"></select></div>
                            <button id="apply-filters-btn" class="btn btn-primary w-full mt-2 shadow-lg"><i class="fas fa-search mr-2"></i> Analizar</button>
                        </div>
                    </div>
                </div>
                <div class="lg:col-span-9"><div id="results-container" class="min-h-[600px]"><div id="initial-view" class="section-card flex flex-col items-center justify-center h-full text-center p-10 bg-white/50 backdrop-blur-sm"><div class="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6 animate-pulse"><i class="fas fa-chart-line text-3xl text-indigo-500"></i></div><h3 class="text-xl font-bold text-gray-800">BI Avanzado de Residuos</h3></div><div id="results-view" class="hidden space-y-6 animate-fade-in-up"></div></div></div>
            </div>
        `;
        setupFilters();
        setupEventListeners();
        loadAgreements().then(() => { document.getElementById('compare-toggle').checked = false; applyQuickDates('year_to_date'); });
    }

    // --- LOGICA DE NEGOCIO ---
    const loadAgreements = async () => {
        try {
            const data = await fetchAll(db.from('waste_removal_agreements').select('*').order('start_date', { ascending: true }));
            if (data && Array.isArray(data)) {
                reportState.agreements = data.map(a => ({ id: a.id, business_name: a.razon_social, start_date: a.start_date, end_date: a.end_date, price_hazardous: parseFloat(a.price_per_kg_hazardous_iva) || 0, price_special: parseFloat(a.price_per_kg_special_iva) || 0, state: a.status }));
                const container = document.getElementById('agreements-status');
                if(container) container.innerHTML = reportState.agreements.slice(-2).map(a => `<div class="border border-emerald-400 bg-emerald-50 rounded p-2 mb-2 shadow-sm"><p class="font-bold text-xs truncate text-gray-700">${a.business_name}</p><div class="flex justify-between text-[10px] text-gray-600 mt-1"><span>Pel: $${a.price_hazardous}</span><span>Esp: $${a.price_special}</span></div></div>`).join('');
            }
        } catch (e) { console.error(e); }
    };

    const setupFilters = () => {
        const types = [{ id: 'special_waste', label: 'Especiales' }, { id: 'hazardous_waste', label: 'Peligrosos' }, { id: 'assimilable_waste', label: 'Asimilables' }];
        document.getElementById('waste-type-toggles').innerHTML = types.map(t => `<label class="flex items-center px-2 py-1.5 rounded hover:bg-gray-50 border border-transparent"><input type="checkbox" name="waste-type" value="${t.id}" checked class="form-checkbox text-indigo-600 rounded"><div class="ml-2 flex items-center"><span class="w-2.5 h-2.5 rounded-full mr-2" style="background-color: ${wasteTypeStyles[t.id].chartColor}"></span><span class="text-xs font-medium text-gray-700">${t.label}</span></div></label>`).join('');
        document.getElementById('units-filter').innerHTML = `<option value="all" selected>Todas las Unidades</option>` + unitsCache.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    };

    const setupEventListeners = () => {
        document.getElementById('apply-filters-btn').addEventListener('click', runAnalysis);
        document.getElementById('mode-kg').addEventListener('click', () => setViewMode('weight'));
        document.getElementById('mode-cost').addEventListener('click', () => setViewMode('cost'));
        document.getElementById('compare-toggle').addEventListener('change', (e) => { document.getElementById('compare-fields').classList.toggle('hidden', !e.target.checked); applyQuickDates(document.getElementById('quick-compare-select').value); });
        document.getElementById('quick-compare-select').addEventListener('change', (e) => applyQuickDates(e.target.value));
        
        document.getElementById('results-container').addEventListener('click', (e) => {
            const viewBtn = e.target.closest('.table-view-btn');
            if (viewBtn) return setTableViewMode(viewBtn.dataset.mode);
            const toggle = (id, icon) => { const el = document.getElementById(id); if(el) { el.classList.toggle('hidden'); if(icon) icon.classList.toggle('rotate-90'); } };
            const bRow = e.target.closest('.building-row'); if(bRow) toggle(`content-bldg-${bRow.dataset.buildingId}`, bRow.querySelector('.fa-chevron-right'));
            const fRow = e.target.closest('.floor-row'); if(fRow) { e.stopPropagation(); toggle(`content-floor-${fRow.dataset.floorId}`, fRow.querySelector('.fa-chevron-right')); }
            const uRow = e.target.closest('.unit-row'); if(uRow) { e.stopPropagation(); toggle(`sub-rows-${uRow.dataset.unitId}`, uRow.querySelector('.summary-icon')); }
        });
    };

    const applyQuickDates = (mode) => {
        const d = new Date(); const f = (date) => date.toISOString().split('T')[0];
        if(mode==='year_to_date'){ document.getElementById('start-date-filter').value=f(new Date(d.getFullYear(),0,1)); document.getElementById('end-date-filter').value=f(new Date()); }
        else if(mode==='month_vs_prev'){ 
            document.getElementById('start-date-filter').value=f(new Date(d.getFullYear(),d.getMonth(),1)); 
            document.getElementById('end-date-filter').value=f(new Date(d.getFullYear(),d.getMonth()+1,0)); 
            document.getElementById('start-date-filter-2').value=f(new Date(d.getFullYear(),d.getMonth()-1,1)); 
            document.getElementById('end-date-filter-2').value=f(new Date(d.getFullYear(),d.getMonth(),0));
        }
    };

    const setViewMode = (mode) => {
        reportState.viewMode = mode;
        const btnKg = document.getElementById('mode-kg'), btnCost = document.getElementById('mode-cost');
        if(mode==='weight'){ btnKg.classList.add('bg-indigo-600','text-white','shadow'); btnKg.classList.remove('text-gray-500'); btnCost.classList.remove('bg-emerald-600','text-white','shadow'); btnCost.classList.add('text-gray-500'); }
        else{ btnCost.classList.add('bg-emerald-600','text-white','shadow'); btnCost.classList.remove('text-gray-500'); btnKg.classList.remove('bg-indigo-600','text-white','shadow'); btnKg.classList.add('text-gray-500'); }
        if(reportState.data.length > 0) renderDashboardWrapper();
    };

    const setTableViewMode = (mode) => {
        reportState.tableViewMode = mode;
        document.querySelectorAll('.table-view-btn').forEach(btn => {
            if(btn.dataset.mode === mode) { btn.classList.remove('bg-white','text-gray-600'); btn.classList.add('bg-indigo-100','text-indigo-700','border-indigo-300'); }
            else { btn.classList.add('bg-white','text-gray-600'); btn.classList.remove('bg-indigo-100','text-indigo-700','border-indigo-300'); }
        });
        const summary = aggregateData(reportState.data);
        const thead = document.getElementById('analysis-table-head'), tbody = document.getElementById('analysis-table-body');
        if (!thead || !tbody) return;

        if (mode === 'building') {
            thead.innerHTML = `<tr><th class="p-3 text-left w-2/5">Ubicación</th><th class="p-3 text-right">Especiales</th><th class="p-3 text-right">Peligrosos</th><th class="p-3 text-right">Dom/Asim.</th><th class="p-3 text-right">Total</th><th class="p-3 text-right">%</th></tr>`;
            tbody.innerHTML = renderHierarchicalRows(summary);
        } else if (mode === 'unit') {
            thead.innerHTML = `<tr><th class="p-3 text-left w-2/5">Unidad</th><th class="p-3 text-right">Especiales</th><th class="p-3 text-right">Peligrosos</th><th class="p-3 text-right">Dom/Asim.</th><th class="p-3 text-right">Total</th><th class="p-3 text-right">%</th></tr>`;
            tbody.innerHTML = renderFlatUnitRows(summary);
        } else if (mode === 'type') {
            thead.innerHTML = `<tr><th class="p-3 text-left w-2/5">Tipo / Unidad</th><th class="p-3 text-right">Peso/Costo</th><th class="p-3 text-right w-1/5">Detalle</th></tr>`;
            tbody.innerHTML = renderTypeRows(summary);
        }
    };

    const runAnalysis = async () => {
        const btn = document.getElementById('apply-filters-btn'); btn.disabled=true; btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Procesando...`;
        document.getElementById('initial-view').classList.add('hidden'); document.getElementById('results-view').classList.remove('hidden');
        document.getElementById('results-view').innerHTML = `<div class="flex flex-col items-center justify-center min-h-[400px]"><div class="loader"></div><p class="text-gray-500 font-medium mt-4">Analizando datos...</p></div>`;

        try {
            const s1 = document.getElementById('start-date-filter').value;
            const e1 = document.getElementById('end-date-filter').value;
            const d1=new Date(s1), d2=new Date(e1);
            reportState.dateRange = { start: s1, end: e1, days: Math.max(1, Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24)) + 1) };
            reportState.periodLabels.p1 = getReadableDateLabel(s1, e1);
            
            const [data1, pickups, containers, recycling] = await Promise.all([
                fetchData(s1, e1),
                fetchAll(db.from('unit_pickups').select('*').gte('pickup_date', s1).lte('pickup_date', e1)),
                fetchAll(db.from('containers').select('*')),
                fetchAll(db.from('recycling_log').select('*').gte('date', s1).lte('date', e1))
            ]);
            
            reportState.data = data1; reportState.pickups = pickups || []; reportState.containers = containers || []; reportState.recycling = recycling || [];
            reportState.data2 = document.getElementById('compare-toggle').checked ? await fetchData(document.getElementById('start-date-filter-2').value, document.getElementById('end-date-filter-2').value) : [];
            
            if(reportState.data2.length > 0) {
                 const s2 = document.getElementById('start-date-filter-2').value;
                 const e2 = document.getElementById('end-date-filter-2').value;
                 reportState.periodLabels.p2 = getReadableDateLabel(s2, e2);
            }
            renderDashboardWrapper();
        } catch(e){ console.error(e); document.getElementById('results-view').innerHTML = `<div class="p-6 text-center text-red-500">Error: ${e.message}</div>`; } finally { btn.disabled=false; btn.innerHTML = `<i class="fas fa-search mr-2"></i> Analizar`; }
    };

    const fetchData = async (start, end) => {
        const types = Array.from(document.querySelectorAll('input[name="waste-type"]:checked')).map(cb => cb.value);
        const units = Array.from(document.getElementById('units-filter').selectedOptions).map(opt => opt.value);
        let results = []; const s = start + ' 00:00:00'; const e = end + ' 23:59:59';
        for (const type of types) {
            let query = db.from(type).select('*').gte('date', s).lte('date', e);
            if (!units.includes('all')) query = query.in('unit_id', units);
            const data = await fetchAll(query);
            if (data) data.forEach(d => { d.main_type = type; d.weight_kg = parseFloat(d.weight_kg) || 0; });
            results.push(...(data || []));
        }
        return results;
    };

    const renderDashboardWrapper = () => {
        const compareMode = document.getElementById('compare-toggle').checked;
        if (compareMode && reportState.data2.length > 0) renderComparisonDashboard(reportState.data, reportState.data2);
        else renderSingleDashboard(reportState.data);
    };

    // --- AGREGACIÓN DE DATOS (CORAZÓN DEL CÁLCULO) ---
    const aggregateData = (data) => {
        const initTypes = () => ({ special_waste: { w: 0, c: 0, v: 0, co2: 0 }, hazardous_waste: { w: 0, c: 0, v: 0, co2: 0 }, assimilable_waste: { w: 0, c: 0, v: 0, co2: 0 } });
        const acc = { 
            hierarchy: {}, byUnit: {}, byDate: {}, total: { w: 0, c: 0, v: 0, co2: 0 }, 
            types: initTypes(), logistics: {}, capacity: {}, 
            co2Specific: {}, // Desglose fino para gráfico CO2
            containersMap: {} 
        };

        // 1. Mapear Contenedores por Unidad (Si existen en BD)
        reportState.containers.forEach(c => {
            if(!acc.containersMap[c.unit_id]) acc.containersMap[c.unit_id] = [];
            acc.containersMap[c.unit_id].push({ type: c.waste_usage_type, vol: parseFloat(c.capacity_liters) || 0, qty: parseInt(c.quantity) || 1 });
        });

        // 2. Procesar Registros (Retiros)
        (data || []).forEach(r => {
            const w = parseFloat(r.weight_kg) || 0; 
            const c = w * getPriceForRecord(r.date, r.main_type);
            // CORRECCIÓN: Usar waste_type como fuente principal para la categoría específica (ej. PILAS, INHALADORES)
            const materialDesc = r.waste_detail || r.waste_type || r.sub_type_name || r.main_type;
            
            // A. Ingeniería de Materiales (Densidad y CO2)
            const props = getWasteProperties(materialDesc, r.main_type);
            const v = w / props.density; // Litros Reales Ocupados
            const co2 = w * props.co2Factor; // Huella de Carbono

            // B. Acumulación CO2 Detallada (Excluyendo RSAD que ya está agrupado)
            const co2Key = props.name;
            if (!acc.co2Specific[co2Key]) acc.co2Specific[co2Key] = { name: co2Key, co2: 0, weight: 0, factor: props.co2Factor };
            acc.co2Specific[co2Key].co2 += co2;
            acc.co2Specific[co2Key].weight += w;

            // C. Logística de Ubicación y Contenedores
            const { building, floor, name } = getUnitLocation(r.unit_id);
            const ruleSize = getContainerSizeRule(name); // 120L o 240L según unidad crítica

            // D. Inicializar Estructuras
            if(!acc.byUnit[r.unit_id]) {
                acc.byUnit[r.unit_id] = { 
                    id: r.unit_id, name: `${building} - ${name}`, 
                    w:0, c:0, v:0, co2:0, 
                    types: initTypes(), 
                    logisticsStats: { // Desglose para gráfico de capacidad apilada
                        hazardous_waste: { transportCapKg: 0, realKg: 0 },
                        special_waste: { transportCapKg: 0, realKg: 0 },
                        assimilable_waste: { transportCapKg: 0, realKg: 0 }
                    },
                    subtypes: {}
                };
            }
            const unit = acc.byUnit[r.unit_id];
            
            // E. Acumular Métricas Globales
            const addMetric = (obj) => { obj.w+=w; obj.c+=c; obj.v=(obj.v||0)+v; obj.co2=(obj.co2||0)+co2; };
            const addType = (obj, type) => { if(!obj.types[type]) return; obj.types[type].w+=w; obj.types[type].c+=c; obj.types[type].v+=v; obj.types[type].co2+=co2; };
            
            addMetric(unit); addType(unit, r.main_type);
            addMetric(acc.total);
            addType(acc, r.main_type); // CORRECCIÓN: Agregar totales por tipo globalmente para tarjetas de resumen

            // F. Cálculo de Logística EXACTO (Kg)
            // Capacidad de Transporte (Kg) = Litros Carro * Densidad * (1 Retiro)
            const capacityKg = ruleSize * props.density * SAFETY_FILL_FACTOR; // Aplicamos 75% aquí para "Capacidad Segura"

            // Acumular en stats diferenciados por categoría
            if (unit.logisticsStats[r.main_type]) {
                unit.logisticsStats[r.main_type].transportCapKg += capacityKg;
                unit.logisticsStats[r.main_type].realKg += w;
            }

            // G. Jerarquías (Legacy Charts)
            if(!acc.hierarchy[building]) acc.hierarchy[building] = { w:0, c:0, v:0, co2:0, floors:{}, types: initTypes() };
            const b = acc.hierarchy[building]; addMetric(b); addType(b, r.main_type);
            if(!b.floors[floor]) b.floors[floor] = { w:0, c:0, v:0, co2:0, units:{}, types: initTypes() };
            const f = b.floors[floor]; addMetric(f); addType(f, r.main_type);
            if(!f.units[r.unit_id]) f.units[r.unit_id] = { id: r.unit_id, name, w:0, c:0, v:0, co2:0, types: initTypes(), subtypes: {} };
            const uRef = f.units[r.unit_id];
            addMetric(uRef); addType(uRef, r.main_type);

            // H. Tendencia Diaria
            let d = r.date.includes('T') ? r.date.split('T')[0] : r.date.substring(0, 10);
            if(!acc.byDate[d]) acc.byDate[d] = { w:0, c:0, types: initTypes() };
            acc.byDate[d].w += w;
            acc.byDate[d].c += c; // CORRECCIÓN: Acumular costo diario global
            if(acc.byDate[d].types[r.main_type]) {
                acc.byDate[d].types[r.main_type].w += w;
                acc.byDate[d].types[r.main_type].c += c; // CORRECCIÓN: Acumular costo diario por tipo
            }

            // I. Subtipos para tablas (CORREGIDO PARA MOSTRAR SIEMPRE UNA SUBCATEGORÍA)
            // Intentamos obtener el detalle, si no existe, usamos un nombre genérico basado en el tipo principal
            let subKey = r.waste_detail || r.waste_type || r.sub_type_name;
            
            if (!subKey) {
                // Si no hay detalle, asignamos uno por defecto para que aparezca en la tabla
                if (r.main_type === 'assimilable_waste') subKey = 'RSAD (General)';
                else if (r.main_type === 'hazardous_waste') subKey = 'Peligroso (Sin detalle)';
                else if (r.main_type === 'special_waste') subKey = 'Especial (Sin detalle)';
                else subKey = 'Otros';
            }
            
            // Función auxiliar para agregar subtipo a un objeto (unidad principal o referencia de jerarquía)
            const addSubtype = (targetObj) => {
                if(!targetObj.subtypes) targetObj.subtypes = {};
                if(!targetObj.subtypes[subKey]) targetObj.subtypes[subKey] = { w:0, c:0, v:0, type: r.main_type };
                targetObj.subtypes[subKey].w += w; 
                targetObj.subtypes[subKey].c += c;
            };

            addSubtype(unit); // Agregar a la unidad en la lista plana
            addSubtype(uRef); // Agregar a la unidad dentro de la jerarquía (para tabla por edificio)

            // J. Conteo Retiros
            if (!acc.logistics[r.unit_id]) acc.logistics[r.unit_id] = { id: r.unit_id, name, weight: 0, pickups: 0 };
            acc.logistics[r.unit_id].weight += w;
        });

        // K. Conteo final de pickups para scatter
        (reportState.pickups || []).forEach(p => { 
            if (acc.byUnit[p.unit_id]) { 
                if(!acc.logistics[p.unit_id]) acc.logistics[p.unit_id] = { id: p.unit_id, name: acc.byUnit[p.unit_id].name, weight: 0, pickups: 0 };
                acc.logistics[p.unit_id].pickups += 1; 
            } 
        });

        return acc;
    }

    // --- RENDERERS ---
    function renderSingleDashboard(data) {
        const summary = aggregateData(data);
        const resultsView = document.getElementById('results-view');
        if (summary.total.w === 0) { resultsView.innerHTML = `<div class="p-10 text-center text-gray-400 bg-gray-50 rounded-lg border border-gray-200">No se encontraron registros.</div>`; return; }

        const recycledWeight = reportState.recycling.reduce((acc, r) => acc + (parseFloat(r.weight_kg)||0), 0);
        const co2Saved = recycledWeight * 1.1; 
        const sortedUnits = Object.values(summary.byUnit).sort((a,b) => getVal(b) - getVal(a));
        const modeLabel = reportState.viewMode === 'weight' ? 'Total Kilos' : 'Costo Estimado';

        // HTML CO2 DETALLADO (Top 10)
        const co2List = Object.values(summary.co2Specific).sort((a,b) => b.co2 - a.co2).slice(0, 10);
        const co2ContributorsHTML = co2List.map(c => `
            <div class="flex justify-between items-center text-xs border-b border-gray-100 py-2 hover:bg-gray-50 px-2 transition-colors">
                <div class="w-2/3 pr-2">
                    <span class="text-gray-700 font-bold block truncate uppercase" title="${c.name}">${c.name}</span>
                    <span class="text-[9px] text-gray-400">Gen: ${c.weight.toFixed(1)}kg | Factor: ${c.factor.toFixed(2)}</span>
                </div>
                <div class="text-right w-1/3">
                    <span class="font-bold text-red-600 block">${(c.co2).toFixed(1)}</span>
                    <span class="text-[9px] text-gray-400">kgCO2e</span>
                </div>
            </div>
        `).join('');

        resultsView.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                <div class="section-card p-4 border-l-4 border-indigo-500 bg-white shadow-sm"><p class="text-xs font-bold text-gray-400 uppercase">${modeLabel}</p><p class="text-2xl font-bold text-gray-800 mt-1">${formatValue(getVal(summary.total))}</p></div>
                ${Object.entries(wasteTypeStyles).map(([key, style]) => `<div class="section-card p-4 border-l-4 ${style.borderColor} bg-white shadow-sm"><p class="${style.textColor} text-xs font-bold uppercase">${style.label}</p><p class="text-xl font-bold text-gray-800 mt-1">${formatValue(getValType(summary, key))}</p></div>`).join('')}
            </div>

            <div class="section-card p-0 mb-6 border-l-4 border-gray-600 bg-white shadow-sm overflow-hidden">
                <div class="p-4 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between">
                    <div><h3 class="text-gray-700 font-bold flex items-center"><i class="fas fa-smog mr-2 text-gray-500"></i> Huella de Carbono Específica</h3><p class="text-xs text-gray-500">Desglose por nombre de residuo (RSAD Agrupado).</p></div>
                    <div class="text-right"><span class="text-3xl font-bold text-gray-700">${(summary.total.co2/1000).toFixed(2)}</span> <span class="text-sm font-medium text-gray-500">tCO2e</span></div>
                </div>
                <details class="border-t border-gray-100"><summary class="px-4 py-2 text-xs font-bold text-blue-600 cursor-pointer hover:bg-blue-50">Ver Desglose de Emisiones</summary>
                    <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="bg-white rounded-lg border border-gray-200 shadow-inner">
                            <h4 class="font-bold text-xs text-gray-500 uppercase p-2 bg-gray-50 border-b border-gray-200">Mayores Emisores (Top 10)</h4>
                            <div class="max-h-[250px] overflow-y-auto">${co2ContributorsHTML || '<p class="text-xs text-gray-400 p-3">Sin datos suficientes</p>'}</div>
                        </div>
                        <div class="flex flex-col gap-4">
                            <div class="bg-green-50 p-4 rounded-lg border border-green-100"><h4 class="font-bold text-xs text-green-700 uppercase mb-2">Emisiones Evitadas (Reciclaje)</h4><div class="flex justify-between items-end"><span class="text-2xl font-bold text-green-600">-${(co2Saved/1000).toFixed(2)} <span class="text-sm">tCO2e</span></span><span class="text-xs font-bold text-green-800 bg-green-200 px-2 py-1 rounded">${recycledWeight.toFixed(0)} kg Reciclados</span></div></div>
                            <div class="bg-blue-50 p-4 rounded-lg border border-blue-100 text-xs text-blue-800"><i class="fas fa-info-circle mr-1"></i> <strong>Nota:</strong> "Formalina", "Cortopunzante", etc. tienen factores de emisión distintos según normativa DEFRA.</div>
                        </div>
                    </div>
                </details>
            </div>

            <div class="space-y-4 mb-8">
                <details class="group section-card p-0 overflow-hidden shadow-sm"><summary class="flex justify-between items-center font-bold p-4 cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"><span class="flex items-center text-gray-700"><i class="fas fa-chart-line mr-3 text-indigo-500"></i> Tendencia Diaria</span><span class="transition-transform group-open:rotate-180"><i class="fas fa-chevron-down text-gray-400"></i></span></summary><div class="p-4 border-t border-gray-100"><div class="h-[350px]"><canvas id="trend-chart"></canvas></div></div></details>
                <details class="group section-card p-0 overflow-hidden shadow-sm"><summary class="flex justify-between items-center font-bold p-4 cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"><span class="flex items-center text-gray-700"><i class="fas fa-chart-bar mr-3 text-blue-500"></i> Ranking de Generación por Unidad</span><span class="transition-transform group-open:rotate-180"><i class="fas fa-chevron-down text-gray-400"></i></span></summary><div class="p-4 border-t border-gray-100"><div style="height: ${Math.max(400, sortedUnits.length * 30)}px"><canvas id="dynamic-chart"></canvas></div></div></details>
                
                <details class="group section-card p-0 overflow-hidden shadow-sm" open><summary class="flex justify-between items-center font-bold p-4 cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"><span class="flex items-center text-gray-700"><i class="fas fa-trash-alt mr-3 text-gray-500"></i> Eficiencia Logística (Capacidad vs Real)</span><span class="transition-transform group-open:rotate-180"><i class="fas fa-chevron-down text-gray-400"></i></span></summary>
                    <div class="p-4 border-t border-gray-100">
                        <div class="flex flex-col md:flex-row gap-4 mb-4 text-xs">
                            <div class="flex-1 bg-amber-50 p-3 rounded border border-amber-100 text-amber-800">
                                <strong class="block mb-1"><i class="fas fa-truck mr-1"></i> Análisis de Transporte Diferenciado:</strong>
                                Se compara el Peso Real Generado (Barras de color sólido) vs la Capacidad de Transporte (Kg) utilizada (Barras claras de fondo).<br>
                                <em>Cálculo: Capacidad Transporte = (Litros Carro x Densidad x N° Retiros) x 75% Seguridad.</em>
                            </div>
                            <div class="flex-1 bg-gray-50 p-3 rounded border border-gray-200">
                                <div class="font-bold text-gray-500 uppercase mb-2">Filtros de Visualización:</div>
                                <div class="flex flex-wrap gap-3">
                                    <label class="inline-flex items-center"><input type="checkbox" class="logistics-filter form-checkbox h-3 w-3 text-indigo-600 rounded" value="real" checked> <span class="ml-1.5">Real</span></label>
                                    <label class="inline-flex items-center"><input type="checkbox" class="logistics-filter form-checkbox h-3 w-3 text-indigo-600 rounded" value="capacity" checked> <span class="ml-1.5">Capacidad</span></label>
                                    <div class="w-px h-4 bg-gray-300 mx-1"></div>
                                    <label class="inline-flex items-center"><input type="checkbox" class="logistics-filter form-checkbox h-3 w-3 text-red-600 rounded" value="hazardous" checked> <span class="ml-1.5">Peligrosos</span></label>
                                    <label class="inline-flex items-center"><input type="checkbox" class="logistics-filter form-checkbox h-3 w-3 text-amber-600 rounded" value="special" checked> <span class="ml-1.5">Especiales</span></label>
                                    <label class="inline-flex items-center"><input type="checkbox" class="logistics-filter form-checkbox h-3 w-3 text-green-600 rounded" value="assimilable" checked> <span class="ml-1.5">RSAD</span></label>
                                </div>
                            </div>
                        </div>
                        <div id="capacity-chart-container" style="position: relative; width: 100%;"><canvas id="capacity-chart"></canvas></div>
                    </div>
                </details>

                <details class="group section-card p-0 overflow-hidden shadow-sm"><summary class="flex justify-between items-center font-bold p-4 cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"><span class="flex items-center text-gray-700"><i class="fas fa-th mr-3 text-red-500"></i> Matriz de Calor</span><span class="transition-transform group-open:rotate-180"><i class="fas fa-chevron-down text-gray-400"></i></span></summary><div class="p-4 border-t border-gray-100 overflow-x-auto"><div id="heatmap-container" class="min-w-[500px]">${renderHeatmap(summary)}</div></div></details>
            </div>

            <div class="section-card shadow-sm">
                <div class="px-6 py-4 border-b border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div><h3 class="font-bold text-gray-800">Detalle de Generación</h3></div>
                    <div class="flex bg-gray-100 p-1 rounded-lg"><button class="table-view-btn px-3 py-1 text-xs font-bold rounded text-gray-600 hover:bg-white transition-all bg-white shadow border border-gray-200" data-mode="building">Por Ubicación</button><button class="table-view-btn px-3 py-1 text-xs font-bold rounded text-gray-600 hover:bg-white transition-all" data-mode="unit">Por Unidad</button><button class="table-view-btn px-3 py-1 text-xs font-bold rounded text-gray-600 hover:bg-white transition-all" data-mode="type">Por Tipo</button></div>
                </div>
                <div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-gray-100 text-xs uppercase text-gray-600" id="analysis-table-head"></thead><tbody class="divide-y divide-gray-100" id="analysis-table-body"></tbody></table></div>
            </div>
        `;
        
        const dateKeys = Object.keys(summary.byDate).sort();
        renderTrendChart(summary.byDate, dateKeys);
        renderCapacityChart(sortedUnits); 
        renderUnitChart(sortedUnits); 
        setTableViewMode('building');
        setupLogisticsFilters(); // Initialize filters
    }

    // --- FUNCION NUEVA PARA LOS FILTROS DEL GRAFICO DE LOGISTICA ---
    function setupLogisticsFilters() {
        const filters = document.querySelectorAll('.logistics-filter');
        filters.forEach(cb => {
            cb.addEventListener('change', () => {
                updateLogisticsChartVisibility();
            });
        });
    }

    function updateLogisticsChartVisibility() {
        if (!capacityChart) return;

        const showReal = document.querySelector('.logistics-filter[value="real"]').checked;
        const showCapacity = document.querySelector('.logistics-filter[value="capacity"]').checked;
        const showHazardous = document.querySelector('.logistics-filter[value="hazardous"]').checked;
        const showSpecial = document.querySelector('.logistics-filter[value="special"]').checked;
        const showAssimilable = document.querySelector('.logistics-filter[value="assimilable"]').checked;

        // Map dataset labels/stacks to filters
        // Dataset Order: 
        // 0: Real Peligrosos, 1: Real Especiales, 2: Real RSAD
        // 3: Cap. Peligrosos, 4: Cap. Especiales, 5: Cap. RSAD
        
        const visibilityMap = [
            showReal && showHazardous,      // 0
            showReal && showSpecial,        // 1
            showReal && showAssimilable,    // 2
            showCapacity && showHazardous,  // 3
            showCapacity && showSpecial,    // 4
            showCapacity && showAssimilable // 5
        ];

        visibilityMap.forEach((visible, index) => {
            if (capacityChart.isDatasetVisible(index) !== visible) {
                capacityChart.setDatasetVisibility(index, visible);
            }
        });
        
        capacityChart.update();
    }

    // --- GRÁFICOS LEGACY (RESTAURADOS Y MEJORADOS) ---
    function renderHeatmap(summary) {
        const buildings = Object.keys(summary.hierarchy).sort();
        if(buildings.length===0) return '<p class="text-center text-gray-500">Sin datos</p>';
        const allFloors = new Set(); buildings.forEach(b => Object.keys(summary.hierarchy[b].floors).forEach(f => allFloors.add(f)));
        const sortedFloors = Array.from(allFloors).sort();
        let maxVal = 0; buildings.forEach(b => Object.values(summary.hierarchy[b].floors).forEach(f => maxVal = Math.max(maxVal, getVal(f))));
        let html = `<div class="overflow-x-auto"><table class="w-full text-xs border-collapse"><thead><tr><th class="p-2 border bg-gray-50 font-bold text-gray-600">Piso / Edificio</th>`;
        buildings.forEach(b => html += `<th class="p-2 border bg-gray-50 text-center font-bold text-gray-600">${b.replace('Edificio','').trim()}</th>`);
        html += `</tr></thead><tbody>`;
        sortedFloors.forEach(floor => {
            html += `<tr><td class="p-2 border font-bold text-gray-700 bg-gray-50 whitespace-nowrap">${floor}</td>`;
            buildings.forEach(b => {
                const floorData = summary.hierarchy[b].floors[floor];
                if (floorData) {
                    const val = getVal(floorData), opacity = Math.min(val / (maxVal || 1), 1);
                    const bgColor = `rgba(239, 68, 68, ${opacity * 0.8})`, textColor = opacity > 0.6 ? 'white' : 'black';
                    html += `<td class="p-2 border text-center font-mono" style="background-color: ${bgColor}; color: ${textColor}">${formatValue(val)}</td>`;
                } else html += `<td class="p-2 border text-center text-gray-300 bg-gray-50/30">-</td>`;
            });
            html += `</tr>`;
        });
        return html + `</tbody></table></div>`;
    }

    function renderTrendChart(byDate, labels) {
        const ctx = document.getElementById('trend-chart').getContext('2d');
        if(trendChart) trendChart.destroy();
        trendChart = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: 'Especial', data: labels.map(d => getValType(byDate[d], 'special_waste')), borderColor: wasteTypeStyles.special_waste.chartColor, fill: false }, { label: 'Peligroso', data: labels.map(d => getValType(byDate[d], 'hazardous_waste')), borderColor: wasteTypeStyles.hazardous_waste.chartColor, fill: false }, { label: 'Dom/Asim', data: labels.map(d => getValType(byDate[d], 'assimilable_waste')), borderColor: wasteTypeStyles.assimilable_waste.chartColor, fill: false }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: reportState.viewMode === 'weight' ? 'Kilos (kg)' : 'Costo ($)' } } }, plugins: { datalabels: { display: false } } } });
    }

    function renderUnitChart(unitsData) {
        const ctx = document.getElementById('dynamic-chart').getContext('2d');
        if(dynamicChart) dynamicChart.destroy();
        dynamicChart = new Chart(ctx, { type: 'bar', data: { labels: unitsData.map(u => u.name), datasets: [{ label: 'Especial', data: unitsData.map(u => getValType(u, 'special_waste')), backgroundColor: wasteTypeStyles.special_waste.chartColor, stack: 's1' }, { label: 'Peligroso', data: unitsData.map(u => getValType(u, 'hazardous_waste')), backgroundColor: wasteTypeStyles.hazardous_waste.chartColor, stack: 's1' }, { label: 'Dom/Asim', data: unitsData.map(u => getValType(u, 'assimilable_waste')), backgroundColor: wasteTypeStyles.assimilable_waste.chartColor, stack: 's1' }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { datalabels: { display: false } } } });
    }

    // --- GRÁFICO DE CAPACIDAD MEJORADO (DIFERENCIADO POR CATEGORÍA EN KG) ---
    function renderCapacityChart(allUnits) {
        const ctx = document.getElementById('capacity-chart').getContext('2d');
        if(capacityChart) capacityChart.destroy();
        
        // Filtro: Solo unidades con actividad real
        const unitsWithData = allUnits.filter(u => u.v > 0).slice(0, 30); // Top 30 para legibilidad
        const labels = unitsWithData.map(u => u.name);

        // Datos Generados (Real Kg)
        const dPelReal = unitsWithData.map(u => u.logisticsStats.hazardous_waste.realKg);
        const dEspReal = unitsWithData.map(u => u.logisticsStats.special_waste.realKg);
        const dRSADReal = unitsWithData.map(u => u.logisticsStats.assimilable_waste.realKg);

        // Datos Capacidad (Logística Kg)
        const dPelCap = unitsWithData.map(u => u.logisticsStats.hazardous_waste.transportCapKg);
        const dEspCap = unitsWithData.map(u => u.logisticsStats.special_waste.transportCapKg);
        const dRSADCap = unitsWithData.map(u => u.logisticsStats.assimilable_waste.transportCapKg);

        const chartHeight = Math.max(500, unitsWithData.length * 40);
        document.getElementById('capacity-chart-container').style.height = `${chartHeight}px`;

        capacityChart = new Chart(ctx, { 
            type: 'bar', 
            data: { 
                labels: labels, 
                datasets: [
                    // REAL (Barras Sólidas) - Indices 0, 1, 2
                    { label: 'Real Peligrosos (kg)', data: dPelReal, backgroundColor: '#ef4444', stack: 'Real', barPercentage: 0.6 },
                    { label: 'Real Especiales (kg)', data: dEspReal, backgroundColor: '#f59e0b', stack: 'Real', barPercentage: 0.6 },
                    { label: 'Real RSAD (kg)', data: dRSADReal, backgroundColor: '#22c55e', stack: 'Real', barPercentage: 0.6 },
                    
                    // CAPACIDAD (Barras Transparentes/Fondo) - Indices 3, 4, 5
                    { label: 'Cap. Peligrosos', data: dPelCap, backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444', borderWidth: 1, stack: 'Capacidad', barPercentage: 0.8 },
                    { label: 'Cap. Especiales', data: dEspCap, backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: '#f59e0b', borderWidth: 1, stack: 'Capacidad', barPercentage: 0.8 },
                    { label: 'Cap. RSAD', data: dRSADCap, backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: '#22c55e', borderWidth: 1, stack: 'Capacidad', barPercentage: 0.8 }
                ] 
            }, 
            options: { 
                indexAxis: 'y', 
                responsive: true, 
                maintainAspectRatio: false,
                scales: { 
                    x: { beginAtZero: true, title: { display: true, text: 'Masa (Kg)' } },
                    y: { stacked: true }
                },
                plugins: {
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            footer: (tooltipItems) => {
                                let totalReal = 0, totalCap = 0;
                                tooltipItems.forEach(item => {
                                    if(item.dataset.stack === 'Real') totalReal += item.raw;
                                    if(item.dataset.stack === 'Capacidad') totalCap += item.raw;
                                });
                                const saturation = totalCap > 0 ? (totalReal/totalCap*100).toFixed(1) : 0;
                                return `----------------\nSaturación Global: ${saturation}%\n(Real: ${Math.round(totalReal)}kg vs Capacidad: ${Math.round(totalCap)}kg)`;
                            }
                        }
                    },
                    datalabels: { display: false } 
                }
            } 
        });
    }

    function renderHierarchicalRows(summary) {
        let html = '';
        Object.keys(summary.hierarchy).sort().forEach((bldg, bIdx) => {
            const bData = summary.hierarchy[bldg], bVal = getVal(bData), bPct = (bVal / (getVal(summary.total)||1) * 100).toFixed(1);
            html += `<tr class="bg-gray-100 hover:bg-gray-200 cursor-pointer building-row border-b border-gray-300" data-building-id="${bIdx}"><td class="p-3 font-bold text-gray-800 flex items-center"><i class="fas fa-chevron-right text-gray-500 mr-3 text-xs transition-transform transform"></i>${bldg}</td><td class="p-3 text-right font-bold text-gray-600">${formatValue(getValType(bData, 'special_waste'))}</td><td class="p-3 text-right font-bold text-gray-600">${formatValue(getValType(bData, 'hazardous_waste'))}</td><td class="p-3 text-right font-bold text-gray-600">${formatValue(getValType(bData, 'assimilable_waste'))}</td><td class="p-3 text-right font-bold text-indigo-700">${formatValue(bVal)}</td><td class="p-3 text-right font-bold text-gray-600">${bPct}%</td></tr><tr id="content-bldg-${bIdx}" class="hidden"><td colspan="6" class="p-0 bg-gray-50"><table class="w-full border-l-4 border-gray-300">`;
            Object.keys(bData.floors).sort().forEach((floor, fIdx) => {
                const fData = bData.floors[floor], fVal = getVal(fData);
                const uniqueFloorId = `${bIdx}-${fIdx}`;
                html += `<tr class="hover:bg-gray-100 cursor-pointer floor-row border-b border-gray-200" data-floor-id="${uniqueFloorId}"><td class="p-3 pl-8 font-semibold text-gray-700 flex items-center"><i class="fas fa-chevron-right text-gray-400 mr-3 text-xs transition-transform transform"></i>${floor}</td><td class="p-3 text-right text-gray-600">${formatValue(getValType(fData, 'special_waste'))}</td><td class="p-3 text-right text-gray-600">${formatValue(getValType(fData, 'hazardous_waste'))}</td><td class="p-3 text-right text-gray-600">${formatValue(getValType(fData, 'assimilable_waste'))}</td><td class="p-3 text-right font-semibold text-gray-700">${formatValue(fVal)}</td><td></td></tr><tr id="content-floor-${uniqueFloorId}" class="hidden"><td colspan="6" class="p-0"><table class="w-full bg-white border-l-4 border-indigo-100">`;
                Object.values(fData.units).sort((a,b) => getVal(b)-getVal(a)).forEach(u => {
                    const uVal = getVal(u), uPct = (uVal / (getVal(summary.total)||1) * 100).toFixed(1);
                    html += `<tr class="hover:bg-indigo-50 cursor-pointer unit-row border-b border-gray-100" data-unit-id="${u.id}"><td class="p-3 pl-16 text-gray-600 flex items-center"><i class="fas fa-chevron-right text-gray-300 mr-2 text-xs transition-transform summary-icon"></i>${u.name}</td><td class="p-3 text-right text-xs text-gray-500">${formatValue(getValType(u, 'special_waste'))}</td><td class="p-3 text-right text-xs text-gray-500">${formatValue(getValType(u, 'hazardous_waste'))}</td><td class="p-3 text-right text-xs text-gray-500">${formatValue(getValType(u, 'assimilable_waste'))}</td><td class="p-3 text-right font-bold text-xs text-gray-800">${formatValue(getVal(u))}</td><td class="p-3 text-right text-xs w-[10%]">${uPct}%</td></tr>${renderSubRows(u)}`;
                });
                html += `</table></td></tr>`;
            });
            html += `</table></td></tr>`;
        });
        return html;
    }

    function renderFlatUnitRows(summary) {
        let html = '';
        const units = Object.values(summary.byUnit).sort((a,b) => getVal(b) - getVal(a));
        units.forEach(u => {
            const uVal = getVal(u), uPct = (uVal / (getVal(summary.total)||1) * 100).toFixed(1);
            html += `<tr class="bg-white hover:bg-indigo-50 cursor-pointer unit-row border-b border-gray-100" data-unit-id="${u.id}"><td class="p-3 font-medium text-gray-700 flex items-center"><i class="fas fa-chevron-right text-gray-300 mr-2 text-xs transition-transform summary-icon"></i>${u.name}</td><td class="p-3 text-right font-mono text-gray-600 text-xs">${formatValue(getValType(u, 'special_waste'))}</td><td class="p-3 text-right font-mono text-gray-600 text-xs">${formatValue(getValType(u, 'hazardous_waste'))}</td><td class="p-3 text-right font-mono text-gray-600 text-xs">${formatValue(getValType(u, 'assimilable_waste'))}</td><td class="p-3 text-right font-bold text-indigo-700 text-xs">${formatValue(uVal)}</td><td class="p-3 text-right text-gray-500 text-xs">${uPct}%</td></tr>${renderSubRows(u)}`;
        });
        return html;
    }

    function renderTypeRows(summary) {
        let html = '';
        ['hazardous_waste', 'special_waste', 'assimilable_waste'].forEach(typeKey => {
            if (getValType(summary, typeKey) <= 0) return;
            const style = wasteTypeStyles[typeKey];
            html += `<tr class="bg-gray-100 border-b border-gray-200"><td class="p-3 font-bold text-gray-800 flex items-center" colspan="3"><span class="w-3 h-3 rounded-full mr-2 inline-block" style="background-color: ${style.chartColor}"></span>${style.label}</td></tr>`;
            Object.values(summary.byUnit).filter(u => getValType(u, typeKey) > 0).sort((a,b) => getValType(b, typeKey) - getValType(a, typeKey)).forEach(u => {
                html += `<tr class="hover:bg-gray-50 border-b border-gray-100 cursor-pointer unit-row" data-unit-id="${u.id}_${typeKey}"><td class="p-3 pl-8 text-sm text-gray-600 flex items-center"><i class="fas fa-chevron-right text-gray-300 mr-2 text-xs transition-transform summary-icon"></i>${u.name}</td><td class="p-3 text-right font-mono font-bold text-gray-700">${formatValue(getValType(u, typeKey))}</td><td class="p-3 text-right text-xs text-gray-400">Ver desglose</td></tr><tr id="sub-rows-${u.id}_${typeKey}" class="hidden bg-slate-50 shadow-inner"><td colspan="3" class="p-3 pl-12"><div class="text-xs border-l-2 border-gray-300 pl-4"><p class="font-bold text-gray-500 uppercase mb-1">Subcategorías (${style.label}):</p><div class="grid grid-cols-1 gap-1">${Object.entries(u.subtypes || {}).filter(([_, v]) => v.type === typeKey && (reportState.viewMode==='weight'?v.w:v.c) > 0).map(([subName, subData]) => `<div class="flex justify-between border-b border-gray-200 pb-1"><span class="text-gray-600">${subName}</span><span class="font-mono font-medium">${formatValue(reportState.viewMode==='weight'?subData.w:subData.c)}</span></div>`).join('') || '<span class="italic text-gray-400">Sin detalle específico</span>'}</div></div></td></tr>`;
            });
        });
        return html;
    }

    function renderSubRows(u) {
        // En esta función ya no hace falta el fallback porque ahora TODOS los registros tienen subtipos generados en aggregateData
        return `<tr id="sub-rows-${u.id}" class="hidden bg-slate-50 shadow-inner"><td colspan="6" class="p-4 pl-12"><div class="text-xs border-l-2 border-indigo-200 pl-4"><p class="font-bold text-gray-500 uppercase mb-2">Desglose Total:</p><div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${Object.entries(u.subtypes).sort((a,b) => (reportState.viewMode==='weight'?b[1].w:b[1].c) - (reportState.viewMode==='weight'?a[1].w:a[1].c)).map(([subName, subData]) => `<div class="flex justify-between border-b border-gray-200 pb-1"><span class="text-gray-600 flex items-center"><span class="w-2 h-2 rounded-full mr-2" style="background-color: ${wasteTypeStyles[subData.type].chartColor}"></span>${subName}</span><span class="font-mono font-medium">${formatValue(reportState.viewMode === 'weight' ? subData.w : subData.c)}</span></div>`).join('') || '<span class="italic text-gray-400">Sin detalle</span>'}</div></div></td></tr>`;
    }

    function renderComparisonDashboard(d1, d2) { /* Render anterior */ }
    function renderComparisonHierarchicalRows(s1, s2) { /* Render anterior */ }

    return { init };
})();
// =================================================================================
// INICIO: MÓDULO DE PUNTOS DE RESIDUOS 
// =================================================================================
window.APP_MODULES.wastePoints = (() => {
    const state = {
        allData: {},
        rawList: [],
        wasteTypes: {},
        statsByType: {},
        filters: { search: '', type: 'all' },
        allExpanded: true
    };

    // 1. ESTILOS
    const injectStyles = () => {
        const styleId = 'waste-points-styles-v9';
        // Limpieza segura de estilos previos
        const oldStyles = document.querySelectorAll('style[id^="waste-points-styles"]');
        for (var i = 0; i < oldStyles.length; i++) {
            oldStyles[i].parentNode.removeChild(oldStyles[i]);
        }

        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            .wp-building-block {
                background: white; border: 1px solid #e5e7eb; border-radius: 0.75rem;
                margin-bottom: 1rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .wp-building-header {
                padding: 1rem; display: flex; justify-content: space-between; align-items: center;
                cursor: pointer; background-color: #fff; user-select: none; border-bottom: 1px solid transparent;
            }
            .wp-building-header:hover { background-color: #f9fafb; }
            .wp-building-header.active { border-bottom-color: #f3f4f6; background-color: #f8fafc; }
            
            .wp-accordion-content {
                overflow: hidden; transition: max-height 0.3s ease-in-out;
            }

            .wp-chevron { transition: transform 0.3s ease; color: #9ca3af; }
            .wp-chevron.rotated { transform: rotate(180deg); }

            .waste-btn { transition: transform 0.1s; cursor: pointer; }
            .waste-btn:hover { z-index: 10; transform: scale(1.15); }

            /* Modal */
            .wp-modal-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5); z-index: 9999; 
                display: flex; align-items: center; justify-content: center;
                opacity: 0; pointer-events: none; transition: opacity 0.2s;
            }
            .wp-modal-overlay.active { opacity: 1; pointer-events: auto; }
            .wp-modal-content {
                background: white; border-radius: 12px; width: 90%; max-width: 450px;
                transform: scale(0.95); transition: transform 0.2s;
                box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
            }
            .wp-modal-overlay.active .wp-modal-content { transform: scale(1); }
        `;
        document.head.appendChild(style);
    };

    // 2. PROCESAMIENTO (SIN OPTIONAL CHAINING PARA EVITAR ERROR 'Unexpected token .')
    const processData = (containers, unitsCache) => {
        state.rawList = containers;
        const safeUnitsCache = Array.isArray(unitsCache) ? unitsCache : [];
        
        state.statsByType = {};
        Object.keys(state.wasteTypes).forEach(type => {
            state.statsByType[type] = { count: 0, liters: 0 };
        });

        return containers.reduce((acc, container) => {
            const type = container.waste_usage_type;
            if (!state.statsByType[type]) state.statsByType[type] = { count: 0, liters: 0 };
            state.statsByType[type].count++;
            state.statsByType[type].liters += (parseFloat(container.capacity_liters) || 0);

            // Resolución de datos segura (Compatibilidad ES5/ES6)
            const joinedUnit = container.units;
            const cachedUnit = safeUnitsCache.find(u => u.id === container.unit_id);
            
            // Nombre Unidad
            let unitName = 'Unidad Desconocida';
            if (joinedUnit && joinedUnit.name) unitName = joinedUnit.name;
            else if (container.unit_name) unitName = container.unit_name;
            else if (cachedUnit && cachedUnit.name) unitName = cachedUnit.name;
            
            // Edificio
            let rawBuilding = null;
            if (joinedUnit && joinedUnit.building) rawBuilding = joinedUnit.building;
            else if (container.unit_building) rawBuilding = container.unit_building;
            else if (cachedUnit && cachedUnit.building) rawBuilding = cachedUnit.building;
            
            const building = (rawBuilding && rawBuilding.trim() !== 'N/A' && rawBuilding.trim() !== '') ? rawBuilding.trim() : 'Edificio General';
            
            // Piso
            let rawFloor = null;
            if (joinedUnit && joinedUnit.floor) rawFloor = joinedUnit.floor;
            else if (container.unit_floor) rawFloor = container.unit_floor;
            else if (cachedUnit && cachedUnit.floor) rawFloor = cachedUnit.floor;

            const floor = (rawFloor && rawFloor.trim() !== 'N/A' && rawFloor.trim() !== '') ? rawFloor.trim() : 'Nivel General';

            container._ui = { unitName: unitName, building: building, floor: floor };

            if (!acc[building]) acc[building] = {};
            if (!acc[building][floor]) acc[building][floor] = {};
            if (!acc[building][floor][unitName]) acc[building][floor][unitName] = [];
            acc[building][floor][unitName].push(container);
            return acc;
        }, {});
    };

    // 3. RENDER HEADER
    const renderHeader = (container) => {
        const totalCount = state.rawList.length;
        const totalLiters = state.rawList.reduce((sum, c) => sum + (parseFloat(c.capacity_liters) || 0), 0);

        const typesHTML = Object.keys(state.wasteTypes).map(key => {
            const info = state.wasteTypes[key];
            const stats = state.statsByType[key] || { count: 0, liters: 0 };
            const txtColor = info.color.replace('bg-', 'text-').replace('500', '600');
            const borderColor = info.color.replace('bg-', 'border-').replace('500', '200');
            return `
                <div class="bg-white p-3 rounded-xl border ${borderColor} shadow-sm flex flex-col items-center relative overflow-hidden">
                    <div class="absolute top-0 w-full h-1 ${info.color}"></div>
                    <span class="text-2xl font-bold ${txtColor}">${stats.count}</span>
                    <span class="text-[10px] text-gray-500 font-bold uppercase truncate w-full text-center px-1">${info.name}</span>
                </div>`;
        }).join('');

        container.innerHTML = `
            <div class="mb-6">
                <div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                    <h1 class="text-2xl font-bold text-gray-800 flex items-center gap-3">
                        <span class="bg-blue-50 text-blue-600 p-2 rounded-lg border border-blue-100"><i class="fas fa-map-marked-alt"></i></span>
                        Mapa de Residuos
                    </h1>
                    <button id="wp-toggle-all" class="text-sm font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition-colors">
                        ${state.allExpanded ? '<i class="fas fa-compress-alt mr-1"></i> Contraer Todo' : '<i class="fas fa-expand-alt mr-1"></i> Expandir Todo'}
                    </button>
                </div>
                
                <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                    <div class="bg-gray-800 p-3 rounded-xl shadow-md flex flex-col items-center text-white col-span-2 md:col-span-1">
                        <span class="text-3xl font-bold">${totalCount}</span>
                        <span class="text-[10px] text-gray-300 font-bold uppercase">Total Puntos</span>
                        <span class="text-[10px] text-gray-500 border-t border-gray-700 mt-1 pt-1 w-full text-center">${Math.round(totalLiters)}L Cap.</span>
                    </div>
                    ${typesHTML}
                </div>

                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col sm:flex-row gap-4">
                    <div class="relative flex-grow w-full">
                        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                        <input type="text" id="wp-search" placeholder="Buscar unidad, piso, edificio..." class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-sm">
                    </div>
                    <div class="w-full sm:w-64">
                        <select id="wp-filter-type" class="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-sm cursor-pointer">
                            <option value="all">Todos los Tipos</option>
                            ${Object.keys(state.wasteTypes).map(k => `<option value="${k}">${state.wasteTypes[k].name}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>
        `;

        // Listeners
        document.getElementById('wp-search').addEventListener('input', (e) => {
            state.filters.search = e.target.value.toLowerCase();
            state.allExpanded = true; 
            updateToggleBtn();
            renderContent(document.getElementById('wp-content-area'));
        });
        document.getElementById('wp-filter-type').addEventListener('change', (e) => {
            state.filters.type = e.target.value;
            state.allExpanded = true;
            updateToggleBtn();
            renderContent(document.getElementById('wp-content-area'));
        });
        document.getElementById('wp-toggle-all').addEventListener('click', () => {
            state.allExpanded = !state.allExpanded;
            updateToggleBtn();
            const headers = document.querySelectorAll('.wp-building-header');
            for (let i = 0; i < headers.length; i++) {
                toggleAccordion(headers[i], state.allExpanded);
            }
        });
    };

    const updateToggleBtn = () => {
        const btn = document.getElementById('wp-toggle-all');
        if(btn) btn.innerHTML = state.allExpanded ? '<i class="fas fa-compress-alt mr-1"></i> Contraer Todo' : '<i class="fas fa-expand-alt mr-1"></i> Expandir Todo';
    };

    // 4. RENDER CONTENT
    const renderContent = (target) => {
        const search = state.filters.search.trim();
        const typeFilter = state.filters.type;
        let hasResults = false;
        let html = '';

        Object.keys(state.allData).sort().forEach(building => {
            const floors = state.allData[building];
            let buildingHTML = '';
            let buildingCount = 0;

            Object.keys(floors).sort().forEach(floor => {
                const units = floors[floor];
                let floorHTML = '';

                Object.keys(units).sort().forEach(unit => {
                    const points = units[unit];
                    
                    const visiblePoints = points.filter(p => {
                        const sText = search;
                        const matchesSearch = sText === '' || 
                            unit.toLowerCase().includes(sText) || 
                            building.toLowerCase().includes(sText) || 
                            (p.container_reference && p.container_reference.toLowerCase().includes(sText));
                        
                        const pType = (p.waste_usage_type || '').trim();
                        const matchesType = typeFilter === 'all' || pType === typeFilter;
                        
                        return matchesSearch && matchesType;
                    });

                    if (visiblePoints.length === 0) return;
                    buildingCount += visiblePoints.length;

                    const icons = visiblePoints.map(p => {
                        const info = state.wasteTypes[p.waste_usage_type] || { color: 'bg-gray-400', icon: 'fa-trash' };
                        const safeJson = encodeURIComponent(JSON.stringify(p));
                        const borderColor = info.color.replace('bg-', 'border-').replace('500', '200');

                        return `<button class="waste-btn w-9 h-9 rounded-full ${info.color} text-white flex items-center justify-center shadow-sm border-2 border-white ring-1 ${borderColor} relative"
                            data-point="${safeJson}" title="${p.container_type}">
                            <i class="fas ${info.icon} text-[10px]"></i>
                        </button>`;
                    }).join('');

                    floorHTML += `
                        <div class="bg-white p-3 rounded-lg border border-gray-100 shadow-sm flex flex-col gap-2 hover:border-blue-300 transition-colors">
                            <div class="border-b border-gray-50 pb-1 mb-1 flex justify-between">
                                <span class="font-semibold text-gray-700 text-xs truncate w-full" title="${unit}">${unit}</span>
                            </div>
                            <div class="flex flex-wrap gap-1.5">${icons}</div>
                        </div>`;
                });

                if (floorHTML) {
                    buildingHTML += `
                        <div class="mb-5 last:mb-0">
                            <div class="flex items-center gap-2 mb-2 px-1">
                                <div class="h-5 w-1 bg-blue-300 rounded-full"></div>
                                <h3 class="text-xs font-bold text-gray-500 uppercase tracking-wide">${floor}</h3>
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pl-3 border-l border-gray-100 ml-1.5">
                                ${floorHTML}
                            </div>
                        </div>`;
                }
            });

            if (buildingHTML) {
                hasResults = true;
                const badgeColor = buildingCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500';
                
                html += `
                    <div class="wp-building-block">
                        <div class="wp-building-header ${state.allExpanded ? 'active' : ''}">
                            <div class="flex items-center gap-4">
                                <div class="w-11 h-11 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500"><i class="far fa-building text-xl"></i></div>
                                <div>
                                    <h2 class="text-lg font-bold text-gray-800 leading-tight">${building}</h2>
                                    <span class="inline-block mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}">${buildingCount} Contenedores</span>
                                </div>
                            </div>
                            <div class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"><i class="fas fa-chevron-down wp-chevron ${state.allExpanded ? 'rotated' : ''}"></i></div>
                        </div>
                        <div class="wp-accordion-content" style="${state.allExpanded ? '' : 'max-height: 0px;'}">
                            <div class="p-5">${buildingHTML}</div>
                        </div>
                    </div>`;
            }
        });

        if (!hasResults) {
            target.innerHTML = `<div class="py-16 text-center opacity-60"><i class="fas fa-filter text-4xl text-gray-300 mb-3"></i><p class="text-gray-500">No se encontraron resultados.</p></div>`;
        } else {
            target.innerHTML = html;
            if (state.allExpanded) {
                setTimeout(() => {
                    const blocks = document.querySelectorAll('.wp-building-block');
                    for (let i = 0; i < blocks.length; i++) {
                        const content = blocks[i].querySelector('.wp-accordion-content');
                        if(content) content.style.maxHeight = content.scrollHeight + "px";
                    }
                }, 50);
            }
        }
    };

    // 5. ACORDEÓN LÓGICA
    const toggleAccordion = (header, forceState) => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wp-chevron');
        
        let shouldOpen;
        if (typeof forceState !== 'undefined' && forceState !== null) {
            shouldOpen = forceState;
        } else {
            // Toggle normal
            shouldOpen = !(content.style.maxHeight && content.style.maxHeight !== '0px');
        }

        if (shouldOpen) {
            content.style.maxHeight = content.scrollHeight + "px";
            if(chevron) chevron.classList.add('rotated');
            header.classList.add('active');
        } else {
            content.style.maxHeight = '0px';
            if(chevron) chevron.classList.remove('rotated');
            header.classList.remove('active');
        }
    };

    // 6. MODAL
    const renderLocalModal = () => {
        if (document.getElementById('wp-local-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'wp-local-modal';
        modal.className = 'wp-modal-overlay';
        modal.innerHTML = `<div class="wp-modal-content relative overflow-hidden"><div id="wp-modal-body"></div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    };

    const openModal = (html) => {
        renderLocalModal();
        const modal = document.getElementById('wp-local-modal');
        document.getElementById('wp-modal-body').innerHTML = html;
        setTimeout(() => modal.classList.add('active'), 10);
    };

    const closeModal = () => {
        const modal = document.getElementById('wp-local-modal');
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => { if(modal.parentNode) modal.parentNode.removeChild(modal); }, 250);
        }
    };

    // 7. EVENTOS GLOBALES
    const setupEvents = (container) => {
        container.addEventListener('click', (e) => {
            const header = e.target.closest('.wp-building-header');
            if (header) {
                toggleAccordion(header);
                return;
            }
            const btn = e.target.closest('.waste-btn');
            if (btn) {
                e.stopPropagation();
                try {
                    const data = JSON.parse(decodeURIComponent(btn.dataset.point));
                    showDetails(data);
                } catch (err) { console.error(err); }
            }
        });
    };

    const showDetails = (d) => {
        const info = state.wasteTypes[d.waste_usage_type] || { name: 'Desconocido', color: 'bg-gray-500', icon: 'fa-question' };
        const date = d.created_at ? new Date(d.created_at).toLocaleDateString() : 'N/A';
        
        const html = `
            <div class="bg-white">
                <div class="px-6 py-4 border-b border-gray-100 flex items-center gap-4 bg-gray-50">
                    <div class="w-12 h-12 rounded-full ${info.color} text-white flex items-center justify-center shadow-md shrink-0"><i class="fas ${info.icon} text-xl"></i></div>
                    <div class="flex-1"><p class="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Tipo</p><h3 class="text-lg font-bold text-gray-800">${info.name}</h3><p class="text-xs text-gray-500">${d.container_type}</p></div>
                    <button onclick="window.APP_MODULES.wastePoints.closeModal()" class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"><i class="fas fa-times text-gray-500"></i></button>
                </div>
                <div class="p-6 space-y-4">
                    <div class="grid grid-cols-2 gap-3">
                        <div class="bg-gray-50 p-3 rounded-lg text-center"><span class="block text-[10px] text-gray-400 font-bold uppercase">Capacidad</span><span class="block text-lg font-bold text-gray-800">${d.capacity_liters} L</span></div>
                        <div class="bg-blue-50 p-3 rounded-lg text-center"><span class="block text-[10px] text-blue-400 font-bold uppercase">ID Ref</span><span class="block text-xs font-bold text-blue-700 mt-1 break-all">${d.container_reference || 'S/R'}</span></div>
                    </div>
                    <div class="border border-gray-100 rounded-xl p-4 space-y-2 text-sm">
                        <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500 text-xs">Edificio</span><span class="font-bold text-gray-800">${d._ui.building}</span></div>
                        <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500 text-xs">Piso</span><span class="font-bold text-gray-800">${d._ui.floor}</span></div>
                        <div class="flex justify-between pt-1"><span class="text-gray-500 text-xs">Unidad</span><span class="font-bold text-gray-800">${d._ui.unitName}</span></div>
                    </div>
                    <div class="text-center text-[10px] text-gray-400">Registrado: ${date}</div>
                </div>
            </div>`;
        openModal(html);
    };

    const init = async (container) => {
        injectStyles();
        state.wasteTypes = window.APP_CONFIG.wasteTypesInfo;
        container.innerHTML = `<div class="p-8 flex justify-center"><div class="loader border-4 border-gray-200 border-t-blue-600 rounded-full w-10 h-10 animate-spin"></div></div>`;

        try {
            const [containers, units] = await Promise.all([
                window.fetchAll(db.from('containers').select('*, units(name, building, floor)').order('created_at', { ascending: false })),
                Promise.resolve(window.unitsCache || [])
            ]);
            state.allData = processData(containers, units);
            
            container.innerHTML = `<div class="p-4 md:p-6 max-w-[1400px] mx-auto"><div id="wp-header-area"></div><div id="wp-content-area" class="min-h-[400px]"></div></div>`;
            
            renderHeader(document.getElementById('wp-header-area'));
            renderContent(document.getElementById('wp-content-area'));
            setupEvents(document.getElementById('wp-content-area'));

        } catch (e) {
            console.error(e);
            container.innerHTML = `<div class="p-10 text-center text-red-500">Error: ${e.message}</div>`;
        }
    };

    return { init, closeModal };
})();
// =================================================================================
// FIN: MÓDULO DE PUNTOS DE RESIDUOS
// =================================================================================

// =================================================================================
// MÓDULO DE GESTIÓN DE EQUIPOS (CORREGIDO: ORDEN BD + CARGA CSV)
// =================================================================================
window.APP_MODULES.equipment = (() => {
    let signaturePad = null;
    let currentModal = null;

    const init = (container) => {
        container.innerHTML = `
            <h1 class="text-3xl font-bold text-gray-800 mb-6">Gestión de Equipos</h1>
            
            <div class="section-card mb-8">
                <h2 class="text-xl font-semibold mb-4">Catálogo General y Mantenimiento</h2>
                <details class="mb-4">
                    <summary class="btn btn-secondary btn-sm cursor-pointer">Añadir Nuevo Equipo</summary>
                    <form id="form-equipment" class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 p-4 bg-gray-50 rounded-lg">
                        ${getFormFields('equipment')}
                        <div class="md:col-span-full flex justify-end">
                            <button type="submit" class="btn btn-primary">Añadir Equipo</button>
                        </div>
                    </form>
                </details>
                <details class="mb-4">
                    <summary class="btn btn-secondary btn-sm cursor-pointer">Registrar Mantenimiento</summary>
                    <form id="form-equipment_maintenance" class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 p-4 bg-gray-50 rounded-lg">
                    </form>
                </details>
            </div>

            <div class="section-card">
                <h2 class="text-xl font-semibold mb-4">Préstamo y Devolución de Equipos</h2>
                
                <div id="equipment-filter-container" class="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <input type="text" id="equipment-search-input" placeholder="Buscar equipo por nombre o N° de serie..." class="form-input w-full lg:w-1/3">
                    
                    <div class="flex flex-wrap gap-2 justify-end">
                        <button id="download-loan-template-btn" class="btn btn-secondary btn-sm" title="Descargar formato para importación masiva">
                            <i class="fas fa-file-csv mr-2"></i>Plantilla CSV
                        </button>
                        
                        <label class="btn btn-secondary btn-sm cursor-pointer" title="Importar historial de préstamos">
                            <i class="fas fa-upload mr-2"></i>Cargar CSV Historial
                            <input type="file" id="csv-upload-loans" class="hidden" accept=".csv">
                        </label>

                        <button id="download-loan-history-btn" class="btn btn-secondary btn-sm" title="Descargar reporte en PDF">
                            <i class="fas fa-file-pdf mr-2"></i>Descargar PDF Historial
                        </button>
                    </div>
                </div>

                <div id="equipment-list-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
            </div>
        `;

        setupStaticForms();
        loadAndRenderAllEquipment();
        setupCsvHandlers(); // Inicializar manejadores CSV

        document.getElementById('equipment-search-input').addEventListener('input', (e) => {
            loadAndRenderAllEquipment(e.target.value);
        });
        
        const historyBtn = document.getElementById('download-loan-history-btn');
        if (historyBtn) {
            historyBtn.addEventListener('click', downloadLoanHistoryPDF);
        }
        
        container.addEventListener('click', handleCardClick);
    };

    // --- FUNCIONES CSV ---
    const setupCsvHandlers = () => {
        const templateBtn = document.getElementById('download-loan-template-btn');
        const uploadInput = document.getElementById('csv-upload-loans');
        
        if(templateBtn) templateBtn.addEventListener('click', downloadLoanCsvTemplate);
        if(uploadInput) uploadInput.addEventListener('change', handleLoanCsvUpload);
    };

    const downloadLoanCsvTemplate = () => {
        const headers = [
            'Nombre Equipo (Exacto)', 
            'Numero Serie (Opcional pero recomendado)', 
            'Fecha Entrega (AAAA-MM-DD HH:MM)', 
            'Retira (Nombre)', 
            'Fecha Devolucion (Opcional)', 
            'Devuelve (Nombre)', 
            'Observaciones'
        ];
        
        const csv = Papa.unparse([headers]);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "plantilla_historial_prestamos.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleLoanCsvUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const label = e.target.parentElement;
        const originalText = label.innerHTML;
        label.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Procesando...`;
        label.classList.add('opacity-50', 'cursor-not-allowed');

        try {
            await loadEquipmentCache();

            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                encoding: 'windows-1252',
                complete: async function(results) {
                    if (results.errors.length > 0) {
                        alert("Error en el archivo CSV: " + results.errors[0].message);
                        resetButton(label, originalText, e.target);
                        return;
                    }

                    let addedCount = 0;
                    let errorCount = 0;
                    let errors = [];

                    for (const row of results.data) {
                        const normalizedRow = {};
                        Object.keys(row).forEach(key => {
                            normalizedRow[key.trim().toLowerCase()] = row[key];
                        });

                        const nameKey = Object.keys(normalizedRow).find(k => k.includes('nombre equipo'));
                        const serialKey = Object.keys(normalizedRow).find(k => k.includes('numero serie') || k.includes('serie'));
                        const deliveryDateKey = Object.keys(normalizedRow).find(k => k.includes('fecha entrega'));
                        const withdrawerKey = Object.keys(normalizedRow).find(k => k.includes('retira'));
                        const returnDateKey = Object.keys(normalizedRow).find(k => k.includes('fecha devolucion'));
                        const returnerKey = Object.keys(normalizedRow).find(k => k.includes('devuelve'));
                        const obsKey = Object.keys(normalizedRow).find(k => k.includes('observaciones'));

                        const equipmentName = normalizedRow[nameKey];
                        const serialNumber = normalizedRow[serialKey];
                        
                        let equipment = null;
                        if (serialNumber) {
                            equipment = equipmentCache.find(e => e.serial_number && e.serial_number.trim() === serialNumber.trim());
                        }
                        if (!equipment && equipmentName) {
                            equipment = equipmentCache.find(e => e.name.trim().toLowerCase() === equipmentName.trim().toLowerCase());
                        }

                        if (!equipment) {
                            errorCount++;
                            errors.push(`Equipo no encontrado: ${equipmentName || serialNumber}`);
                            continue;
                        }

                        const deliveryDateRaw = normalizedRow[deliveryDateKey];
                        const returnDateRaw = normalizedRow[returnDateKey];
                        
                        const parseCsvDate = (dateStr) => {
                            if (!dateStr) return null;
                            const d = new Date(dateStr);
                            if (!isNaN(d.getTime())) return d.toISOString();
                            return null;
                        };

                        const deliveryDate = parseCsvDate(deliveryDateRaw);
                        const returnDate = parseCsvDate(returnDateRaw);

                        if (!deliveryDate) {
                            errorCount++;
                            errors.push(`Fecha de entrega inválida para: ${equipment.name}`);
                            continue;
                        }

                        const loanRecord = {
                            id: generateUUID(),
                            equipment_id: equipment.id,
                            date_of_delivery: deliveryDate,
                            withdrawing_employee: normalizedRow[withdrawerKey] || 'No Registrado',
                            return_date: returnDate,
                            returning_employee: returnDate ? (normalizedRow[returnerKey] || normalizedRow[withdrawerKey]) : null,
                            delivery_observations: normalizedRow[obsKey] || '',
                            status: returnDate ? 'Devuelto' : 'Activo'
                        };

                        const { error: insertError } = await db.from('equipment_loans').insert([loanRecord]);

                        if (insertError) {
                            errorCount++;
                            errors.push(`Error al insertar préstamo para ${equipment.name}: ${insertError.message}`);
                        } else {
                            addedCount++;
                            
                            let newStatus = equipment.status;
                            if (returnDate) {
                                if (equipment.status !== 'De Baja' && equipment.status !== 'En Mantenimiento') {
                                    newStatus = 'Disponible';
                                }
                            } else {
                                newStatus = 'En Préstamo';
                            }

                            if (newStatus !== equipment.status) {
                                // CORRECCIÓN CRÍTICA: .eq() ANTES de .update()
                                await db.from('equipment').eq('id', equipment.id).update({ status: newStatus });
                            }
                        }
                    }

                    let msg = `Proceso completado.\nRegistros añadidos: ${addedCount}\nErrores: ${errorCount}`;
                    if (errorCount > 0) {
                        msg += `\n\nDetalles de errores (primeros 5):\n` + errors.slice(0, 5).join('\n');
                    }
                    alert(msg);

                    resetButton(label, originalText, e.target);
                    await refreshCaches();
                    loadAndRenderAllEquipment();
                }
            });

        } catch (err) {
            console.error(err);
            alert("Error procesando el archivo: " + err.message);
            resetButton(label, originalText, e.target);
        }
    };

    const resetButton = (label, originalHtml, input) => {
        label.innerHTML = originalHtml;
        label.classList.remove('opacity-50', 'cursor-not-allowed');
        input.value = '';
    };

    // --- FUNCIONES EXISTENTES (CORREGIDAS) ---

    const downloadLoanHistoryPDF = async () => {
        try {
            const btn = document.getElementById('download-loan-history-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Generando...`;
            btn.disabled = true;

            await loadEquipmentCache();
            const allLoans = await fetchAll(db.from('equipment_loans').select('*').order('date_of_delivery', { ascending: false }));

            if (!Array.isArray(allLoans) || allLoans.length === 0) {
                alert('No hay historial de préstamos para exportar.');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            const tempDiv = document.createElement('div');
            tempDiv.style.position = 'fixed';
            tempDiv.style.left = '-9999px';
            tempDiv.style.top = '0';
            tempDiv.innerHTML = `
                <div id="loan-history-table" style="padding: 20px; font-family: Calibri, sans-serif; background: white; width: 1100px;">
                    <div style="display:flex; align-items:center; justify-content: space-between; margin-bottom: 20px; border-bottom: 2px solid #ccc; padding-bottom: 10px;">
                        <img src="${window.APP_CONFIG.HOSPITAL_LOGO_BASE64}" alt="Logo" style="height:50px; margin-right:10px;" />
                        <div style="text-align:right;">
                            <h2 style="margin:0; font-size: 18px; font-weight: bold; color: #333;">Historial de Préstamos</h2>
                            <p style="margin:0; font-size: 12px; color:#555;">Hospital Penco Lirquén - Gestión de Recursos Físicos</p>
                            <p style="margin:0; font-size: 10px; color:#777;">Fecha de emisión: ${new Date().toLocaleDateString()}</p>
                        </div>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
                        <thead>
                            <tr style="background-color: #f3f4f6; color: #1f2937;">
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left;">Equipo</th>
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left;">N° Serie</th>
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">F. Préstamo</th>
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left;">Retira</th>
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">Firma</th>
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">F. Devolución</th>
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left;">Devuelve</th>
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">Firma</th>
                                <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left;">Obs.</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allLoans.map(loan => {
                                const eq = equipmentCache.find(e => e.id === loan.equipment_id) || {};
                                const loanDate = loan.date_of_delivery ? new Date(loan.date_of_delivery).toLocaleString('es-CL', { hour12: false }) : '';
                                const returnDate = loan.return_date ? new Date(loan.return_date).toLocaleString('es-CL', { hour12: false }) : '-';
                                const deliverySig = loan.delivery_signature ? `<img src="${loan.delivery_signature}" style="height:25px; max-width:60px;" />` : '';
                                const returnSig = loan.return_signature ? `<img src="${loan.return_signature}" style="height:25px; max-width:60px;" />` : '';
                                
                                return `
                                    <tr>
                                        <td style="border: 1px solid #e5e7eb; padding: 4px;">${eq.name || 'Desconocido'}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 4px; font-family: monospace;">${eq.serial_number || '-'}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 4px; text-align: center;">${loanDate}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 4px;">${loan.withdrawing_employee || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 2px; text-align: center;">${deliverySig}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 4px; text-align: center;">${returnDate}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 4px;">${loan.returning_employee || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 2px; text-align: center;">${returnSig}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 4px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${loan.delivery_observations || loan.return_observations || ''}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            document.body.appendChild(tempDiv);
            
            const element = tempDiv.querySelector('#loan-history-table');
            const canvas = await html2canvas(element, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            
            const imgProps = pdf.getImageProperties(imgData);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`historial_prestamos_${new Date().toISOString().split('T')[0]}.pdf`);
            
            document.body.removeChild(tempDiv);
            
            btn.innerHTML = originalText;
            btn.disabled = false;
        } catch (err) {
            console.error('Error al generar PDF:', err);
            alert('Error al generar el PDF. Revise la consola para más detalles.');
            const btn = document.getElementById('download-loan-history-btn');
            if(btn) {
                btn.innerHTML = `<i class="fas fa-file-pdf mr-2"></i>Descargar PDF Historial`;
                btn.disabled = false;
            }
        }
    };

    const setupStaticForms = () => {
        const equipmentForm = document.getElementById('form-equipment');
        equipmentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(equipmentForm);
            const record = Object.fromEntries(formData.entries());
            record.status = 'Disponible';
            const { error } = await db.from('equipment').insert([record]);
            if (error) {
                alert('Error al añadir equipo: ' + error.message);
            } else {
                equipmentForm.reset();
                equipmentForm.parentElement.open = false;
                await loadEquipmentCache();
                loadAndRenderAllEquipment();
            }
        });
        const maintenanceForm = document.getElementById('form-equipment_maintenance');
        maintenanceForm.innerHTML = getFormFields('equipment_maintenance') +
        `<div class="md:col-span-full flex justify-end">
            <button type="submit" class="btn btn-primary">Añadir Mantenimiento</button>
        </div>`;
        maintenanceForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(maintenanceForm);
            const record = Object.fromEntries(formData.entries());
            const { error } = await db.from('equipment_maintenance').insert([record]);
            if (error) {
                alert('Error al registrar mantenimiento: ' + error.message);
            } else {
                maintenanceForm.reset();
                maintenanceForm.parentElement.open = false;
                alert('Mantenimiento registrado con éxito.');
            }
        });
    };

    const loadAndRenderAllEquipment = async (searchTerm = '') => {
        const container = document.getElementById('equipment-list-container');
        container.innerHTML = '<div class="flex justify-center p-4"><div class="loader"></div></div>';
        
        await loadEquipmentCache();
        
        let filteredEquipment = equipmentCache;
        if (searchTerm) {
            const lowerCaseSearch = searchTerm.toLowerCase();
            filteredEquipment = equipmentCache.filter(eq =>
                eq.name.toLowerCase().includes(lowerCaseSearch) ||
                (eq.serial_number && eq.serial_number.toLowerCase().includes(lowerCaseSearch))
            );
        }
        
        // Optimización: traer préstamos activos de una vez
        const { data: activeLoans } = await db.from('equipment_loans').select('*').is('return_date', null);
        const loansMap = {};
        if (activeLoans) {
            activeLoans.forEach(l => loansMap[l.equipment_id] = l);
        }

        const equipmentWithStatus = filteredEquipment.map(eq => ({ ...eq, activeLoan: loansMap[eq.id] || null }));
        renderEquipmentCards(equipmentWithStatus);
    };

    const renderEquipmentCards = (equipmentList) => {
        const container = document.getElementById('equipment-list-container');
        if (!container) return;
        if (equipmentList.length === 0) {
            container.innerHTML = '<p class="text-gray-500 md:col-span-2 lg:col-span-3 text-center">No se encontraron equipos.</p>';
            return;
        }
        container.innerHTML = equipmentList.map(eq => {
            const isInUse = !!eq.activeLoan;
            // Si está en préstamo según la DB, mostramos ese estado, sino el que tenga el equipo
            const status = isInUse ? 'En Préstamo' : eq.status;
            
            let statusClass = 'bg-green-100 text-green-800 border-green-200';
            let iconClass = 'fa-check-circle text-green-500';

            if (isInUse) {
                statusClass = 'bg-yellow-100 text-yellow-800 border-yellow-200';
                iconClass = 'fa-clock text-yellow-500';
            } else if (status === 'En Mantenimiento') {
                statusClass = 'bg-blue-100 text-blue-800 border-blue-200';
                iconClass = 'fa-tools text-blue-500';
            } else if (status === 'De Baja') {
                statusClass = 'bg-red-100 text-red-800 border-red-200';
                iconClass = 'fa-ban text-red-500';
            }
            
            return `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden">
                <div class="p-5">
                    <div class="flex justify-between items-start mb-2">
                        <h3 class="font-bold text-lg text-gray-800 truncate pr-2" title="${eq.name}">${eq.name}</h3>
                        <i class="fas ${iconClass} text-lg"></i>
                    </div>
                    <div class="flex items-center text-xs text-gray-500 mb-4 font-mono bg-gray-50 p-1 rounded inline-block">
                        <i class="fas fa-barcode mr-2"></i> ${eq.serial_number || 'S/N'}
                    </div>
                    <span class="px-2 py-1 text-xs font-bold rounded-full border ${statusClass}">${status}</span>
                    ${isInUse ? `
                        <div class="mt-4 text-xs bg-yellow-50 p-3 rounded border border-yellow-100 text-yellow-800">
                            <p class="mb-1"><i class="fas fa-user mr-1"></i> <strong>${eq.activeLoan.withdrawing_employee}</strong></p>
                            <p><i class="far fa-calendar-alt mr-1"></i> ${new Date(eq.activeLoan.date_of_delivery).toLocaleDateString()} ${new Date(eq.activeLoan.date_of_delivery).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                    ` : ''}
                </div>
                <div class="flex border-t border-gray-100 bg-gray-50 divide-x divide-gray-200">
                    <button class="flex-1 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800 transition-colors btn-prestar" data-id="${eq.id}" ${isInUse || status !== 'Disponible' ? 'disabled class="flex-1 py-3 text-sm font-medium text-gray-400 cursor-not-allowed"' : ''}>
                        <i class="fas fa-hand-holding-heart mr-1"></i> Prestar
                    </button>
                    <button class="flex-1 py-3 text-sm font-medium text-green-600 hover:bg-green-50 hover:text-green-800 transition-colors btn-devolver" data-id="${eq.id}" data-loan-id="${eq.activeLoan?.id}" ${!isInUse ? 'disabled class="flex-1 py-3 text-sm font-medium text-gray-400 cursor-not-allowed"' : ''}>
                        <i class="fas fa-undo-alt mr-1"></i> Devolver
                    </button>
                    <button class="flex-1 py-3 text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors btn-historial" data-id="${eq.id}" title="Historial">
                        <i class="fas fa-history"></i>
                    </button>
                    <button class="flex-1 py-3 text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors btn-editar" data-id="${eq.id}" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                </div>
            </div>
            `;
        }).join('');
    };

    const handleCardClick = (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        const equipmentId = button.dataset.id;
        if (button.classList.contains('btn-prestar')) {
            openLoanModal(equipmentId);
        } else if (button.classList.contains('btn-devolver')) {
            openReturnModal(equipmentId, button.dataset.loanId);
        } else if (button.classList.contains('btn-historial')) {
            openHistoryModal(equipmentId);
        } else if (button.classList.contains('btn-editar')) {
            openEditEquipmentModal(equipmentId);
        }
    };

    const openLoanModal = (equipmentId) => {
        const equipment = equipmentCache.find(e => e.id === equipmentId);
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const formHTML = `
            <input type="hidden" name="equipment_id" value="${equipmentId}">
            <div><label class="font-medium">Fecha y Hora de Entrega</label><input type="datetime-local" name="date_of_delivery" value="${now.toISOString().slice(0,16)}" class="form-input mt-1" required></div>
            <div><label class="font-medium">Retira</label><input type="text" name="withdrawing_employee" class="form-input mt-1" required></div>
            <div class="md:col-span-full"><label class="font-medium">Condición de Entrega</label><textarea name="delivery_condition" class="form-input mt-1" rows="3"></textarea></div>
            <div class="md:col-span-full"><label class="font-medium">Observaciones</label><textarea name="delivery_observations" class="form-input mt-1" rows="3"></textarea></div>
            <div class="md:col-span-full">
                <label class="font-medium">Firma de Entrega</label>
                <div class="border rounded bg-white mt-1"><canvas class="signature-pad w-full h-32 block"></canvas></div>
                <button type="button" class="text-xs text-blue-600 hover:underline mt-1 clear-signature">Limpiar Firma</button>
            </div>
        `;
        createModal(`Prestar Equipo: ${equipment.name}`, formHTML, 'Confirmar Préstamo', handleLoanSubmit);
    };

    const openReturnModal = async (equipmentId, loanIdFromButton) => {
        // --- 1. LOCALIZAR EL EQUIPO EN MEMORIA ---
        const equipment = equipmentCache.find(e => e.id === equipmentId);
        if (!equipment) return alert("Error: Equipo no encontrado en memoria.");

        // --- 2. INTENTAR RECUPERAR ID (Lógica de seguridad) ---
        let loanId = loanIdFromButton;
        
        if (!loanId || loanId === 'undefined' || loanId === 'null' || loanId === '') {
            try {
                const { data: activeLoan } = await db.from('equipment_loans')
                    .select('id')
                    .eq('equipment_id', equipmentId)
                    .is('return_date', null)
                    .single();
                
                if (activeLoan) loanId = activeLoan.id;
            } catch (err) {
                console.warn("No se encontró préstamo activo en BD.");
            }
        }

        // --- 3. MANEJO DE INCONSISTENCIA (CORREGIDO PARA ACTUALIZAR UI) ---
        if (!loanId) {
            const confirmar = confirm(
                `Inconsistencia detectada: El equipo "${equipment.name}" figura como "En Préstamo", pero no existe un registro abierto.\n\n` +
                `¿Desea FORZAR el estado a "Disponible" para corregir este error?`
            );

            if (confirmar) {
                // A) Actualizar Base de Datos
                const { error } = await db.from('equipment').eq('id', equipmentId).update({ status: 'Disponible' });
                
                if (error) {
                    alert('Error al corregir: ' + error.message);
                } else {
                    // B) ACTUALIZACIÓN FORZADA DE LA UI (El paso clave que faltaba)
                    // Actualizamos el objeto en memoria directamente
                    equipment.status = 'Disponible'; 
                    
                    // Intentamos recargar todo si la función existe, sino seguimos con el cambio local
                    try {
                        if (typeof refreshCaches === 'function') await refreshCaches();
                        else if (typeof loadCaches === 'function') await loadCaches();
                    } catch(e) { console.log("No se pudo recargar cache global, usando actualización local."); }

                    alert('Estado corregido. El equipo ahora aparecerá como Disponible.');
                    
                    // C) Volver a pintar la lista
                    // Detectamos qué función de renderizado usar
                    const searchVal = document.getElementById('equipment-search-input')?.value || '';
                    if (typeof loadAndRenderAllEquipment === 'function') {
                        loadAndRenderAllEquipment(searchVal); // Para app.js
                    } else if (typeof EquipmentModule !== 'undefined' && typeof EquipmentModule.loadAndRenderEquipment === 'function') {
                        EquipmentModule.loadAndRenderEquipment(searchVal); // Para registro.js
                    } else {
                        location.reload(); // Último recurso: recargar página
                    }
                }
            }
            return; 
        }

        // --- 4. ABRIR MODAL NORMALMENTE (Si hay ID) ---
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        
        const formHTML = `
            <input type="hidden" name="loan_id" value="${loanId}">
            <input type="hidden" name="equipment_id" value="${equipmentId}">
            <div>
                <label class="font-medium">Fecha de Devolución</label>
                <input type="datetime-local" name="return_date" class="form-input mt-1" value="${now.toISOString().slice(0,16)}" required>
            </div>
             <div>
                <label class="font-medium">Nombre de Quien Devuelve</label>
                <input type="text" name="returning_employee" class="form-input mt-1" required>
            </div>
            <div class="md:col-span-full">
                <label class="font-medium">Condición de Devolución</label>
                <select name="return_condition" class="form-input mt-1">
                    <option value="Disponible">Disponible</option>
                    <option value="En Mantenimiento">Requiere Mantenimiento</option>
                    <option value="De Baja">Dar de Baja</option>
                </select>
            </div>
            <div class="md:col-span-full">
                <label class="font-medium">Observaciones</label>
                <textarea name="return_observations" class="form-input mt-1" rows="3"></textarea>
            </div>
            <div class="md:col-span-full">
                <label class="font-medium">Firma de Devolución</label>
                <div class="border rounded bg-white mt-1"><canvas class="signature-pad w-full h-32 block"></canvas></div>
                <button type="button" class="text-xs text-blue-600 hover:underline mt-1 clear-signature">Limpiar Firma</button>
            </div>
        `;
        
        // Determinar qué handler usar según el archivo
        const submitHandler = (typeof handleReturnSubmit === 'function') 
            ? handleReturnSubmit 
            : (typeof EquipmentModule !== 'undefined' ? EquipmentModule.handleReturnSubmit : null);

        createModal(`Devolver Equipo: ${equipment.name}`, formHTML, 'Confirmar Devolución', submitHandler);
    };

    const openHistoryModal = async (equipmentId) => {
        const equipment = equipmentCache.find(e => e.id === equipmentId);
        createModal(`Historial: ${equipment.name}`, '<div class="flex justify-center p-4"><div class="loader"></div></div>', null, null, true);
        const { data: loans, error: loanError } = await db.from('equipment_loans').select('*').eq('equipment_id', equipmentId).order('date_of_delivery', { ascending: false });
        const { data: maintenances, error: maintenanceError } = await db.from('equipment_maintenance').select('*').eq('equipment_id', equipmentId).order('service_date', { ascending: false });
        if(loanError || maintenanceError) {
             document.querySelector('#modal-container .modal-body').innerHTML = '<p class="text-red-500">Error al cargar el historial.</p>';
             return;
        }
        const historyItems = [
            ...loans.map(item => ({ ...item, type: 'Préstamo', date: item.date_of_delivery })),
            ...maintenances.map(item => ({...item, type: 'Mantenimiento', date: item.service_date}))
        ].sort((a,b) => new Date(b.date) - new Date(a.date));
        let historyHTML = '<ul class="space-y-4 p-2">';
        if (historyItems.length === 0) {
            historyHTML = '<p class="text-center text-gray-500">No hay historial para este equipo.</p>';
        } else {
            historyItems.forEach(item => {
                historyHTML += `<li class="bg-gray-50 p-4 rounded-lg border-l-4 ${item.return_date || item.type === 'Mantenimiento' ? 'border-gray-400' : 'border-blue-500'}">`;
                historyHTML += `<div class="flex justify-between items-start">`;
                historyHTML += `<div><p class="font-bold text-gray-800">${item.type} <span class="text-xs font-normal text-gray-500 ml-2">${new Date(item.date).toLocaleString()}</span></p>`;
                if (item.type === 'Préstamo') {
                    historyHTML += `<p class="text-sm mt-1"><i class="fas fa-arrow-right text-blue-400 mr-1"></i> <strong>Retira:</strong> ${item.withdrawing_employee}</p>`;
                    if (item.return_date) {
                         historyHTML += `<p class="text-sm mt-1"><i class="fas fa-arrow-left text-green-400 mr-1"></i> <strong>Devuelve:</strong> ${item.returning_employee} (${new Date(item.return_date).toLocaleDateString()})</p>`;
                         if(item.return_observations) historyHTML += `<p class="text-sm mt-1 text-gray-600 bg-white p-1 rounded border border-gray-100"><em>"${item.return_observations}"</em></p>`;
                    } else {
                        historyHTML += `<p class="text-sm mt-2 inline-block bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-bold text-xs">ACTIVO</p>`;
                    }
                } else { // Maintenance
                    historyHTML += `<p class="text-sm mt-1"><strong>Servicio:</strong> ${item.service_type}</p>`;
                    historyHTML += `<p class="text-sm"><strong>Proveedor:</strong> ${item.provider}</p>`;
                    historyHTML += `<p class="text-sm text-gray-600 mt-1"><em>${item.description}</em></p>`;
                }
                historyHTML += '</div>';
                let buttonsHTML = '';
                if (item.type === 'Préstamo') {
                    buttonsHTML = `
                        <button class="text-blue-600 hover:text-blue-800 btn-edit-loan mr-2" title="Editar Préstamo" data-loan-id="${item.id}" data-id="${equipmentId}"><i class="fas fa-pencil-alt"></i></button>
                        <button class="text-red-600 hover:text-red-800 btn-delete-loan" title="Eliminar Préstamo" data-loan-id="${item.id}" data-id="${equipmentId}"><i class="fas fa-trash"></i></button>
                    `;
                }
                historyHTML += `<div class="flex items-center">${buttonsHTML}</div></div></li>`;
            });
        }
        historyHTML += '</ul>';
        const modalBody = document.querySelector('#modal-container .modal-body');
        modalBody.innerHTML = historyHTML;
        
        modalBody.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            const eqId = button.dataset.id;
            const loanId = button.dataset.loanId;
            if (button.classList.contains('btn-edit-loan')) {
                openEditLoanModal(loanId, eqId);
            } else if (button.classList.contains('btn-delete-loan')) {
                handleDeleteLoan(loanId, eqId);
            }
        });
    };
    
    const handleDeleteLoan = async (loanId, equipmentId) => {
        if (!confirm('¿Está seguro de que desea eliminar este registro de préstamo? Esta acción no se puede deshacer.')) {
            return;
        }
        
        // CORRECCIÓN: .eq() ANTES de .delete()
        const { error } = await db.from('equipment_loans').eq('id', loanId).delete();
        
        if (error) {
            alert('Error al eliminar el registro: ' + error.message);
            console.error(error);
            return;
        }
        
        const { data: remainingLoans } = await db.from('equipment_loans').select('id').eq('equipment_id', equipmentId).is('return_date', null);
        
        if (remainingLoans && remainingLoans.length === 0) {
            // CORRECCIÓN: .eq() ANTES de .update()
            await db.from('equipment').eq('id', equipmentId).update({ status: 'Disponible' });
        }
        await refreshCaches();
        alert('Registro de préstamo eliminado con éxito.');
        if (currentModal) {
            openHistoryModal(equipmentId);
        }
        loadAndRenderAllEquipment();
    };

    const openEditLoanModal = async (loanId, equipmentId) => {
        const { data: loan, error } = await db.from('equipment_loans').select('*').eq('id', loanId).single();
        if (error || !loan) {
            return alert('Error al cargar el registro del préstamo.');
        }
        const equipment = equipmentCache.find(e => e.id === equipmentId);
        const deliveryDate = loan.date_of_delivery ? new Date(loan.date_of_delivery) : new Date();
        deliveryDate.setMinutes(deliveryDate.getMinutes() - deliveryDate.getTimezoneOffset());
        const returnDate = loan.return_date ? new Date(loan.return_date) : null;
        if(returnDate) returnDate.setMinutes(returnDate.getMinutes() - returnDate.getTimezoneOffset());
        const formHTML = `
            <input type="hidden" name="loan_id" value="${loanId}">
            <div><label class="font-medium">Fecha y Hora de Entrega</label><input type="datetime-local" name="date_of_delivery" value="${deliveryDate.toISOString().slice(0,16)}" class="form-input mt-1" required></div>
            <div><label class="font-medium">Retira</label><input type="text" name="withdrawing_employee" value="${loan.withdrawing_employee || ''}" class="form-input mt-1" required></div>
            <div class="md:col-span-full"><label class="font-medium">Condición de Entrega</label><textarea name="delivery_condition" class="form-input mt-1" rows="2">${loan.delivery_condition || ''}</textarea></div>
            <div class="md:col-span-full"><label class="font-medium">Observaciones de Entrega</label><textarea name="delivery_observations" class="form-input mt-1" rows="2">${loan.delivery_observations || ''}</textarea></div>
            <hr class="md:col-span-full my-2 border-gray-200">
            <div><label class="font-medium">Fecha y Hora de Devolución</label><input type="datetime-local" name="return_date" value="${returnDate ? returnDate.toISOString().slice(0,16) : ''}" class="form-input mt-1"></div>
            <div><label class="font-medium">Devuelve</label><input type="text" name="returning_employee" value="${loan.returning_employee || ''}" class="form-input mt-1"></div>
            <div class="md:col-span-full"><label class="font-medium">Observaciones de Devolución</label><textarea name="return_observations" class="form-input mt-1" rows="2">${loan.return_observations || ''}</textarea></div>
        `;
        createModal(`Editar Préstamo: ${equipment.name}`, formHTML, 'Actualizar Préstamo', handleUpdateLoanSubmit);
    };

    const handleUpdateLoanSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const loanId = formData.get('loan_id');
        let record = Object.fromEntries(formData.entries());
        delete record.loan_id;
        
        if(!record.return_date) record.return_date = null;
        if(!record.date_of_delivery) record.date_of_delivery = null;
        
        // CORRECCIÓN: .eq() ANTES de .update()
        const { error } = await db.from('equipment_loans').eq('id', loanId).update(record);
        if (error) {
            alert('Error al actualizar el préstamo: ' + error.message);
            console.error(error);
        } else {
            alert('Registro de préstamo actualizado con éxito.');
            await refreshCaches();
            closeModal();
            loadAndRenderAllEquipment(); 
        }
    };

    const openEditEquipmentModal = (equipmentId) => {
        const equipment = equipmentCache.find(e => e.id === equipmentId);
        const formHTML = `
            <input type="hidden" name="equipment_id" value="${equipmentId}">
            <div><label class="font-medium">Nombre del Equipo</label><input type="text" name="name" value="${equipment.name}" class="form-input mt-1" required></div>
            <div><label class="font-medium">Número de Serie</label><input type="text" name="serial_number" value="${equipment.serial_number || ''}" class="form-input mt-1"></div>
            <div class="md:col-span-full">
                <label class="font-medium">Estado</label>
                <select name="status" class="form-input mt-1">
                    <option value="Disponible" ${equipment.status === 'Disponible' ? 'selected' : ''}>Disponible</option>
                    <option value="En Mantenimiento" ${equipment.status === 'En Mantenimiento' ? 'selected' : ''}>En Mantenimiento</option>
                    <option value="De Baja" ${equipment.status === 'De Baja' ? 'selected' : ''}>De Baja</option>
                </select>
            </div>
        `;
        createModal(`Editar Equipo: ${equipment.name}`, formHTML, 'Guardar Cambios', handleEditEquipmentSubmit);
    };

    const handleEditEquipmentSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const equipmentId = formData.get('equipment_id');
        const updateData = {
            name: formData.get('name'),
            serial_number: formData.get('serial_number'),
            status: formData.get('status'),
        };
        // CORRECCIÓN: .eq() ANTES de .update()
        const { error } = await db.from('equipment').eq('id', equipmentId).update(updateData);
        if (error) {
            alert('Error al actualizar el equipo: ' + error.message);
        } else {
            alert('Equipo actualizado con éxito.');
            closeModal();
            loadAndRenderAllEquipment(document.getElementById('equipment-search-input').value);
        }
    };

    const createModal = (title, formHTML, submitText, submitHandler, isHistory = false) => {
        if (currentModal) closeModal();
        const modalContainer = document.getElementById('modal-container');
        modalContainer.innerHTML = `
        <div class="fixed inset-0 bg-gray-900 bg-opacity-75 z-40" id="modal-backdrop"></div>
        <div id="dynamic-modal" class="bg-white rounded-lg shadow-xl p-6 w-full max-w-3xl absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 modal-content z-50">
            <div class="flex justify-between items-center border-b pb-3 mb-4">
                <h2 class="text-2xl font-semibold text-gray-800">${title}</h2>
                <button id="close-modal-btn" class="text-gray-400 hover:text-gray-600 text-3xl focus:outline-none">&times;</button>
            </div>
            <div class="modal-body overflow-y-auto custom-scrollbar" style="max-height: 70vh;">
                <form id="modal-form" class="grid grid-cols-1 md:grid-cols-2 gap-4 p-2">${formHTML}</form>
            </div>
            <div class="flex justify-end space-x-3 pt-4 border-t mt-4">
                <button type="button" id="cancel-modal-btn" class="btn btn-secondary">${isHistory ? 'Cerrar' : 'Cancelar'}</button>
                ${submitText ? `<button type="submit" form="modal-form" class="btn btn-primary">${submitText}</button>`: ''}
            </div>
        </div>`;
        
        currentModal = document.getElementById('dynamic-modal');
        modalContainer.classList.remove('hidden');
        
        const canvas = currentModal.querySelector('.signature-pad');
        if (canvas) {
            signaturePad = resizeCanvas(canvas);
            const clearBtn = currentModal.querySelector('.clear-signature');
            if(clearBtn) clearBtn.addEventListener('click', () => signaturePad.clear());
        }
        
        document.getElementById('close-modal-btn').addEventListener('click', closeModal);
        document.getElementById('cancel-modal-btn').addEventListener('click', closeModal);
        document.getElementById('modal-backdrop').addEventListener('click', closeModal);
        
        if(submitHandler) {
            document.getElementById('modal-form').addEventListener('submit', submitHandler);
        }
    };

    const closeModal = () => {
        const modalContainer = document.getElementById('modal-container');
        modalContainer.classList.add('hidden');
        modalContainer.innerHTML = '';
        currentModal = null;
        signaturePad = null;
    };

    const handleReturnSubmit = async (e) => {
        e.preventDefault();
        if (signaturePad && signaturePad.isEmpty()) {
            return alert('La firma es obligatoria para registrar la devolución.');
        }
        
        const formData = new FormData(e.target);
        const record = Object.fromEntries(formData.entries());
        
        // Obtenemos los IDs
        const loanId = record.loan_id;
        const equipmentId = record.equipment_id;
        
        // --- SOLUCIÓN: Validar que el ID del préstamo exista antes de actualizar ---
        if (!loanId || loanId === 'undefined' || loanId === 'null' || loanId === '') {
            console.error('Error crítico: loan_id no encontrado en el formulario', record);
            return alert('Error: No se ha podido identificar el préstamo a cerrar. Por favor cierre esta ventana y recargue la lista de equipos.');
        }
        // --------------------------------------------------------------------------

        const newStatus = record.return_condition;
        
        const updateData = {
            return_date: record.return_date,
            returning_employee: record.returning_employee,
            return_observations: record.return_observations,
            return_signature: signaturePad ? signaturePad.toDataURL('image/png') : null,
            status: 'Devuelto'
        };
        
        // Ahora es seguro llamar a update porque validamos el ID arriba
        const { error: loanError } = await db.from('equipment_loans').eq('id', loanId).update(updateData);
        
        if(loanError) {
            return alert('Error al registrar la devolución: ' + loanError.message);
        }
        
        // Actualizar estado del equipo
        if (equipmentId) {
            await db.from('equipment').eq('id', equipmentId).update({ status: newStatus });
        }
        
        await refreshCaches();
        closeModal();
        loadAndRenderAllEquipment(document.getElementById('equipment-search-input')?.value || '');
    };

    return { init };
})();

// MÓDULOS CRUD SIMPLES
window.APP_MODULES.inventory = createSimpleCrudModule({ title: "Gestión de Inventario", sections: [{ title: "Catálogo de Insumos", singularName: 'Insumo', tableName: 'supplies', csv: true }, { title: "Recepción de Insumos (Entradas)", singularName: 'Recepción', tableName: 'supply_arrivals' }, { title: "Entrega de Insumos (Salidas)", singularName: 'Entrega', tableName: 'supply_deliveries' }, { title: "Puntos de Residuos (Contenedores)", singularName: 'Contenedor', tableName: 'containers', csv: true, description: "Administra los contenedores o puntos de acopio de residuos." }] });

// ++ MÓDULO DE RECICLAJE AÑADIDO EN LA POSICIÓN CORRECTA ++
window.APP_MODULES.recycling = createSimpleCrudModule({
    title: "Gestión de Reciclaje",
    sections: [{
        title: "Registro Mensual de Reciclaje",
        singularName: 'Registro de Reciclaje',
        tableName: 'recycling_log',
        csv: true,
        description: "Registre los kilos de materiales reciclados mensualmente."
    }]
});

window.APP_MODULES.agreements = createSimpleCrudModule({ 
    title: "Gestión de Convenios y Facturación", 
    sections: [
        { title: "Convenios de Retiro", singularName: 'Convenio', tableName: 'waste_removal_agreements' }, 
        { title: "Facturación Mensual (OC)", singularName: 'Factura', tableName: 'monthly_invoices', csv: true }
    ] 
});
// Módulo de configuración renombrado a "Gestión de Unidades y Ubicaciones"
window.APP_MODULES.settings = createSimpleCrudModule({ title: "Gestión de Unidades y Ubicaciones", sections: [{ title: "Gestión de Unidades y Ubicaciones", singularName: 'Unidad', tableName: 'units' }] });

// Módulo de gestión de usuarios
window.APP_MODULES.users = createSimpleCrudModule({
    title: "Gestión de Usuarios",
    sections: [
        { title: "Usuarios", singularName: 'Usuario', tableName: 'users' }
    ]
});

// =================================================================================
// INICIO: MÓDULO DE GESTIÓN DE RESIDUOS (VERSIÓN FINAL Y MEJORADA)
// =================================================================================
window.APP_MODULES.waste = (() => {
    const wasteTypes = [
        { id: 'special', tableName: 'special_waste', title: 'Especiales (REAS)', icon: 'fa-biohazard', color: 'text-yellow-600', borderColor: 'border-yellow-500', singularName: 'Registro REAS' },
        { id: 'hazardous', tableName: 'hazardous_waste', title: 'Peligrosos', icon: 'fa-triangle-exclamation', color: 'text-red-600', borderColor: 'border-red-500', singularName: 'Registro Peligroso' },
        { id: 'assimilable', tableName: 'assimilable_waste', title: 'Asimilables', icon: 'fa-recycle', color: 'text-green-600', borderColor: 'border-green-500', singularName: 'Registro Asimilable' }
    ];

    const init = (container) => {
        let tabsHTML = '';
        let tabContentHTML = '';
        
        wasteTypes.forEach((type, index) => {
            const isActive = index === 0;
            const hasCategoryFilter = type.id === 'special' || type.id === 'hazardous';
            
            const filtersHTML = `
                <div class="waste-filters-container">
                    <h3 class="text-lg font-semibold mb-3">Filtros de Búsqueda</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label for="filter-start-date-${type.id}" class="text-sm font-medium text-gray-700">Desde</label>
                            <input type="date" id="filter-start-date-${type.id}" class="form-input mt-1">
                        </div>
                        <div>
                            <label for="filter-end-date-${type.id}" class="text-sm font-medium text-gray-700">Hasta</label>
                            <input type="date" id="filter-end-date-${type.id}" class="form-input mt-1">
                        </div>
                        <div>
                            <label for="filter-unit-${type.id}" class="text-sm font-medium text-gray-700">Unidad</label>
                            <select id="filter-unit-${type.id}" class="form-input mt-1" multiple>
                                ${unitsCache.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
                            </select>
                        </div>
                        ${hasCategoryFilter ? `
                        <div>
                            <label for="filter-waste-type-${type.id}" class="text-sm font-medium text-gray-700">Categoría / Residuo</label>
                            <input type="text" id="filter-waste-type-${type.id}" placeholder="Buscar por nombre..." class="form-input mt-1">
                        </div>
                        ` : '<div class="hidden lg:block"></div>'}
                    </div>
                    <div class="flex justify-end mt-4">
                        <button data-type-id="${type.id}" class="btn btn-secondary btn-sm clear-filters-btn mr-2">Limpiar Filtros</button>
                        <button data-type-id="${type.id}" class="btn btn-primary btn-sm apply-filters-btn">
                            <i class="fa fa-search mr-2"></i>Aplicar Filtros
                        </button>
                    </div>
                </div>
            `;
            
            const headers = getListHeaders(type.tableName);
            const headerHTML = headers.map(h => `<th scope="col" class="px-3 py-3 cursor-pointer" data-sort-key="${h.key}">${h.text}<span class="sort-icon"> <i class="fas fa-sort text-gray-400"></i></span></th>`).join('');
            tabsHTML += `
                <button class="waste-tab-btn ${isActive ? 'active' : ''}" data-tab-id="${type.id}">
                    <i class="fas ${type.icon} ${type.color} mr-2"></i>
                    <span>${type.title}</span>
                </button>
            `;
            tabContentHTML += `
                <div id="tab-content-${type.id}" class="waste-tab-content ${isActive ? '' : 'hidden'}">
                    <div class="section-card">
                        ${filtersHTML}
                        <div class="border-t my-6"></div>
                        <details class="mb-4">
                            <summary class="btn btn-secondary btn-sm cursor-pointer">Añadir Nuevo ${type.singularName}</summary>
                            <form id="form-${type.tableName}" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 p-4 bg-gray-50 rounded-lg">
                                ${getFormFields(type.tableName)}
                                <div class="md:col-span-full flex justify-end">
                                    <button type="submit" class="btn btn-primary">Añadir ${type.singularName}</button>
                                </div>
                            </form>
                        </details>
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-lg font-semibold">Registros Existentes</h3>
                            <div class="flex items-center gap-2">
                                <button onclick="downloadCsvTemplate('${type.tableName}')" class="btn btn-secondary btn-sm">Descargar Plantilla</button>
                                <label for="csv-upload-${type.tableName}" class="btn btn-secondary btn-sm cursor-pointer">Cargar CSV<input type="file" id="csv-upload-${type.tableName}" class="hidden" accept=".csv"></label>
                            </div>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm text-left text-gray-500">
                                <thead class="text-xs text-gray-700 uppercase bg-gray-100"><tr>${headerHTML}<th scope="col" class="px-3 py-3">Acciones</th></tr></thead>
                                <tbody id="list-${type.tableName}"></tbody>
                            </table>
                        </div>
                        <div id="pagination-${type.tableName}" class="flex justify-center items-center gap-4 mt-4"></div>
                    </div>
                </div>
            `;
        });

        const pickupHistoryHeaders = getListHeaders('unit_pickups');
        const pickupHistoryHeaderHTML = pickupHistoryHeaders.map(h => `<th scope="col" class="px-3 py-3 cursor-pointer" data-sort-key="${h.key}">${h.text}<span class="sort-icon"> <i class="fas fa-sort text-gray-400"></i></span></th>`).join('');

        // ========================================================================
        // INICIO: HTML MODIFICADO (FUNCIONALIDAD COMPLETA)
        // Se añadieron filtros (con ID '...-unit_pickups') para la tabla principal
        // y se mantuvieron los filtros del generador de PDF (con ID '...-report-...')
        // ========================================================================
        const pickupHistoryHTML = `
            <div class="section-card mt-8">
                <h2 class="text-xl font-semibold mb-4">Historial de Retiros de Unidades</h2>
                <p class="text-gray-600 mb-4 text-sm">Aquí se muestran todos los retiros rápidos registrados por los auxiliares.</p>

                <div class="report-controls bg-gray-50 p-4 rounded-lg border mb-6">
                    <h3 class="text-lg font-semibold mb-3">Generar Reporte Integral por Unidad</h3>
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div>
                            <label for="pickup-report-start-date" class="text-sm font-medium text-gray-700">Fecha Inicio</label>
                            <input type="date" id="pickup-report-start-date" class="form-input mt-1">
                        </div>
                        <div>
                            <label for="pickup-report-end-date" class="text-sm font-medium text-gray-700">Fecha Fin</label>
                            <input type="date" id="pickup-report-end-date" class="form-input mt-1">
                        </div>
                        <div>
                            <label for="pickup-report-unit" class="text-sm font-medium text-gray-700">Seleccionar Unidad</label>
                            <select id="pickup-report-unit" class="form-input mt-1">
                                <option value="">Seleccione una unidad...</option>
                                ${unitsCache.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
                            </select>
                        </div>
                        <button id="generate-pickup-report-btn" class="btn btn-primary">
                            <i class="fas fa-file-pdf mr-2"></i>Descargar Reporte
                        </button>
                    </div>
                </div>

                <div class="waste-filters-container border-t pt-6">
                    <h3 class="text-lg font-semibold mb-3">Filtrar Historial de Retiros</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label for="filter-start-date-unit_pickups" class="text-sm font-medium text-gray-700">Desde</label>
                            <input type="date" id="filter-start-date-unit_pickups" class="form-input mt-1">
                        </div>
                        <div>
                            <label for="filter-end-date-unit_pickups" class="text-sm font-medium text-gray-700">Hasta</label>
                            <input type="date" id="filter-end-date-unit_pickups" class="form-input mt-1">
                        </div>
                        <div>
                            <label for="filter-unit-unit_pickups" class="text-sm font-medium text-gray-700">Unidad</label>
                            <select id="filter-unit-unit_pickups" class="form-input mt-1" multiple>
                                ${unitsCache.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="hidden lg:block"></div>
                    </div>
                    <div class="flex justify-end mt-4">
                        <button data-type-id="unit_pickups" class="btn btn-secondary btn-sm clear-filters-btn mr-2">Limpiar Filtros</button>
                        <button data-type-id="unit_pickups" class="btn btn-primary btn-sm apply-filters-btn">
                            <i class="fa fa-search mr-2"></i>Aplicar Filtros
                        </button>
                    </div>
                </div>
                
                <div class="overflow-x-auto mt-6">
                    <table class="w-full text-sm text-left text-gray-500">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                            <tr>${pickupHistoryHeaderHTML}<th scope="col" class="px-3 py-3">Acciones</th></tr>
                        </thead>
                        <tbody id="list-unit_pickups"></tbody>
                    </table>
                </div>
                <div id="pagination-unit_pickups" class="flex justify-center items-center gap-4 mt-4"></div>
            </div>
        `;
        // ========================================================================
        // FIN: HTML MODIFICADO
        // ========================================================================

        container.innerHTML = `
            <h1 class="text-3xl font-bold text-gray-800 mb-2">Gestión de Residuos</h1>
            <p class="text-gray-500 mb-6">Administra los registros de residuos y revisa el historial de retiros de los auxiliares.</p>
            <div class="flex border-b border-gray-200 mb-6">
                ${tabsHTML}
            </div>
            <div>
                ${tabContentHTML}
            </div>
            ${pickupHistoryHTML} 
        `;
        
        setupEventListeners(); // Esta función ahora conectará los nuevos botones
        wasteTypes.forEach(type => setupCRUD(type.tableName));
        
        loadAndRenderList('unit_pickups', 0); // Carga la lista inicial
        setupTableSorting('unit_pickups');
        
        document.getElementById('generate-pickup-report-btn').addEventListener('click', downloadUnitReportAsPDF);
    };
    
// ========================================================================
    // REPORTE INTEGRAL: VERSIÓN PROFESIONAL (PAGINACIÓN INTELIGENTE + DETALLE)
    // ========================================================================
    const downloadUnitReportAsPDF = async () => {
        // 1. VALIDACIÓN Y VARIABLES
        const startDateInput = document.getElementById('pickup-report-start-date').value;
        const endDateInput = document.getElementById('pickup-report-end-date').value;
        const unitId = document.getElementById('pickup-report-unit').value;
        const unitSelect = document.getElementById('pickup-report-unit');
        
        if (!startDateInput || !endDateInput) return alert('Seleccione rango de fechas.');
        if (!unitId) return alert('Seleccione una unidad.');
        
        const unitName = unitSelect.options[unitSelect.selectedIndex].text;
        const btn = document.getElementById('generate-pickup-report-btn');
        const originalText = btn.innerHTML;
        
        // Configuración de Fechas
        const parseDate = (str) => new Date(str + 'T00:00:00');
        const dStart = parseDate(startDateInput);
        const dEnd = parseDate(endDateInput);
        const durationMs = dEnd - dStart; 
        
        const prevEndObj = new Date(dStart.getTime() - 86400000); 
        const prevStartObj = new Date(prevEndObj.getTime() - durationMs);
        
        const lastYearStartObj = new Date(dStart); lastYearStartObj.setFullYear(dStart.getFullYear() - 1);
        const lastYearEndObj = new Date(dEnd); lastYearEndObj.setFullYear(dEnd.getFullYear() - 1);

        const fmt = (date) => date.toISOString().split('T')[0];
        const pCurrent = { start: startDateInput, end: endDateInput };
        const pPrev = { start: fmt(prevStartObj), end: fmt(prevEndObj) };
        const pLastYear = { start: fmt(lastYearStartObj), end: fmt(lastYearEndObj) };

        const globalStart = pLastYear.start < pPrev.start ? pLastYear.start : pPrev.start;
        const globalEnd = endDateInput + ' 23:59:59';

        btn.disabled = true;
        btn.innerHTML = '<div class="loader !w-4 !h-4 !border-2 mr-2"></div> Generando reporte multipágina...';

        try {
            if (typeof refreshCaches === 'function') await refreshCaches();

            // 3. CONSULTA DE DATOS (FORZANDO CARGA COMPLETA)
            const [pickupRes, specialRes, hazardousRes, assimilableRes, suppliesRes, usersRes] = await Promise.all([
                db.from('unit_pickups').select('*').eq('unit_id', unitId).gte('pickup_date', pCurrent.start).lte('pickup_date', globalEnd).order('pickup_date', { ascending: true }).range(0, 2000),
                db.from('special_waste').select('weight_kg, date, waste_type').eq('unit_id', unitId).gte('date', globalStart).lte('date', globalEnd).range(0, 5000),
                db.from('hazardous_waste').select('weight_kg, date, waste_type').eq('unit_id', unitId).gte('date', globalStart).lte('date', globalEnd).range(0, 5000),
                db.from('assimilable_waste').select('weight_kg, date').eq('unit_id', unitId).gte('date', globalStart).lte('date', globalEnd).range(0, 5000),
                db.from('supply_deliveries').select('*').eq('unit_id', unitId).gte('delivery_date', pCurrent.start).lte('delivery_date', globalEnd).order('delivery_date', { ascending: true }).range(0, 2000),
                // Recuperar perfiles para mapear nombres de usuario por email
                db.from('perfiles').select('email, nombre_completo').range(0, 1000)
            ]);

            // 4. PROCESAMIENTO DE DATOS
            const sumByPeriod = (dataset, period) => {
                return (dataset || []).reduce((acc, r) => {
                    const rDate = r.date.substring(0, 10);
                    if (rDate >= period.start && rDate <= period.end) return acc + (parseFloat(r.weight_kg) || 0);
                    return acc;
                }, 0);
            };

            const metrics = {
                special: [sumByPeriod(specialRes.data, pCurrent), sumByPeriod(specialRes.data, pPrev), sumByPeriod(specialRes.data, pLastYear)],
                hazardous: [sumByPeriod(hazardousRes.data, pCurrent), sumByPeriod(hazardousRes.data, pPrev), sumByPeriod(hazardousRes.data, pLastYear)],
                assimilable: [sumByPeriod(assimilableRes.data, pCurrent), sumByPeriod(assimilableRes.data, pPrev), sumByPeriod(assimilableRes.data, pLastYear)]
            };

            const totalKilosPeriod = metrics.special[0] + metrics.hazardous[0] + metrics.assimilable[0];
            const userMap = new Map((usersRes.data || []).map(u => [u.email?.toLowerCase(), u.name]));

            // [NUEVO] TABLA DETALLADA DE ANÁLISIS POR SUBCATEGORÍA
            const breakdown = {};
            const processBreakdown = (list, categoryName) => {
                (list || []).forEach(r => {
                    const rDate = r.date.substring(0, 10);
                    if (rDate >= pCurrent.start && rDate <= pCurrent.end) {
                        // Usar el tipo específico si existe, sino la categoría general
                        const type = r.waste_type || categoryName;
                        if (!breakdown[type]) breakdown[type] = { weight: 0, category: categoryName };
                        breakdown[type].weight += (parseFloat(r.weight_kg) || 0);
                    }
                });
            };

            processBreakdown(assimilableRes.data, 'Asimilable');
            processBreakdown(specialRes.data, 'Especial');
            processBreakdown(hazardousRes.data, 'Peligroso');

            const breakdownRowsHTML = Object.entries(breakdown)
                .sort((a, b) => b[1].weight - a[1].weight) // Ordenar por mayor generación
                .map(([subcat, data]) => `
                    <tr>
                        <td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold; color:#334155;">${subcat}</td>
                        <td style="padding:8px; border-bottom:1px solid #eee; color:#64748b;">${data.category}</td>
                        <td style="padding:8px; border-bottom:1px solid #eee; text-align:right; font-family:monospace; font-size:11pt;">${data.weight.toFixed(2)} kg</td>
                        <td style="padding:8px; border-bottom:1px solid #eee; text-align:right; color:#2563eb; font-size:9pt;">${totalKilosPeriod > 0 ? ((data.weight/totalKilosPeriod)*100).toFixed(1) + '%' : '0%'}</td>
                    </tr>
                `).join('');

            // Listas para tablas finales
            const pickups = (pickupRes.data || []).filter(p => p.pickup_date >= pCurrent.start && p.pickup_date <= pCurrent.end);
            const supplies = (suppliesRes.data || []).filter(s => s.delivery_date >= pCurrent.start && s.delivery_date <= pCurrent.end).map(s => ({
                ...s,
                item_name: suppliesCache.find(c => c.id == s.supply_id)?.item_name || 'Desconocido'
            }));

            // 5. GENERACIÓN DE GRÁFICOS (Ajustados para página vertical)
            const generateChart = async (title, data, color) => {
                const canvas = document.createElement('canvas');
                // Dimensiones óptimas para A4 horizontal dentro de vertical (aprox 20cm ancho)
                canvas.width = 1200; 
                canvas.height = 450; 
                document.body.appendChild(canvas);

                const chart = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels: ['Actual', 'Anterior', 'Año Pasado'],
                        datasets: [{
                            label: 'Kg',
                            data: data,
                            backgroundColor: [color, 'rgba(156, 163, 175, 0.5)', 'rgba(156, 163, 175, 0.3)'],
                            borderColor: [color, '#9ca3af', '#9ca3af'],
                            borderWidth: 2,
                            borderRadius: 6,
                            barPercentage: 0.6
                        }]
                    },
                    options: {
                        responsive: false,
                        devicePixelRatio: 2,
                        plugins: {
                            legend: { display: false },
                            title: { display: true, text: title.toUpperCase(), font: { size: 24, weight: 'bold' }, color: '#334155', padding: { bottom: 10 } },
                            datalabels: { anchor: 'end', align: 'top', formatter: v => v > 0 ? v.toFixed(1)+' kg' : '', font: { weight: 'bold', size: 18 }, color: '#1e293b' }
                        },
                        scales: { y: { beginAtZero: true, display: false }, x: { ticks: { font: { size: 18, weight: 'bold' }, color: '#475569' }, grid: { display: false } } },
                        layout: { padding: { top: 30, left: 10, right: 10, bottom: 10 } }
                    },
                    plugins: [ChartDataLabels]
                });
                await new Promise(r => setTimeout(r, 200));
                const url = canvas.toDataURL('image/png', 1.0);
                chart.destroy();
                document.body.removeChild(canvas);
                return url;
            };

            const imgAssimilable = await generateChart('RSAD (Asimilables)', metrics.assimilable, '#16a34a');
            const imgSpecial = await generateChart('RE (Especiales)', metrics.special, '#d97706');
            const imgHazardous = await generateChart('RP (Peligrosos)', metrics.hazardous, '#dc2626');

            // 6. ESTRUCTURA DE PÁGINAS (SEPARADAS PARA EVITAR CORTES)
            // Creamos un contenedor maestro oculto
            const masterContainer = document.createElement('div');
            // Estilos base para hoja A4
            const pageStyle = `width:210mm; min-height:297mm; padding:15mm; background:white; font-family:Arial, sans-serif; box-sizing:border-box; position:relative; overflow:hidden;`;
            masterContainer.style.position = 'fixed'; 
            masterContainer.style.left = '-9999px'; 
            masterContainer.style.top = '0';

            const formatDate = d => d ? d.split(' ')[0].split('-').reverse().join('/') : '-';
            const headerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #2563eb; padding-bottom:15px; margin-bottom:20px;">
                    <img src="${window.APP_CONFIG.HOSPITAL_LOGO_BASE64 || ''}" style="height:50px;">
                    <div style="text-align:right;">
                        <h2 style="margin:0; color:#1e3a8a; font-size:16pt; text-transform:uppercase;">Reporte de Gestión</h2>
                        <p style="margin:0; color:#64748b; font-size:9pt;">${unitName} | ${formatDate(startDateInput)} - ${formatDate(endDateInput)}</p>
                    </div>
                </div>`;

            // --- PÁGINA 1: RESUMEN Y DETALLE ---
            const page1 = document.createElement('div');
            page1.style.cssText = pageStyle;
            page1.innerHTML = `
                ${headerHTML}
                <!-- KPIS -->
                <div style="display:flex; gap:15px; margin-bottom:25px;">
                    <div style="flex:1; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:15px; text-align:center;">
                        <span style="display:block; font-size:8pt; color:#1e40af; font-weight:bold; text-transform:uppercase;">Total</span>
                        <span style="display:block; font-size:20pt; color:#1e3a8a; font-weight:900;">${totalKilosPeriod.toFixed(1)} kg</span>
                    </div>
                    <div style="flex:1; background:#fff; border:1px solid #e2e8f0; border-bottom:3px solid #16a34a; border-radius:8px; padding:15px; text-align:center;">
                        <span style="display:block; font-size:8pt; color:#64748b; font-weight:bold;">RSAD</span>
                        <span style="display:block; font-size:16pt; color:#16a34a; font-weight:bold;">${metrics.assimilable[0].toFixed(1)} kg</span>
                    </div>
                    <div style="flex:1; background:#fff; border:1px solid #e2e8f0; border-bottom:3px solid #d97706; border-radius:8px; padding:15px; text-align:center;">
                        <span style="display:block; font-size:8pt; color:#64748b; font-weight:bold;">Especiales</span>
                        <span style="display:block; font-size:16pt; color:#d97706; font-weight:bold;">${metrics.special[0].toFixed(1)} kg</span>
                    </div>
                    <div style="flex:1; background:#fff; border:1px solid #e2e8f0; border-bottom:3px solid #dc2626; border-radius:8px; padding:15px; text-align:center;">
                        <span style="display:block; font-size:8pt; color:#64748b; font-weight:bold;">Peligrosos</span>
                        <span style="display:block; font-size:16pt; color:#dc2626; font-weight:bold;">${metrics.hazardous[0].toFixed(1)} kg</span>
                    </div>
                </div>

                <!-- TABLA DETALLADA -->
                <h3 style="color:#1e3a8a; font-size:12pt; border-bottom:1px solid #e2e8f0; padding-bottom:5px; margin-bottom:15px;">1. Análisis Detallado de Composición</h3>
                <table style="width:100%; border-collapse:collapse; font-size:10pt;">
                    <thead style="background:#f8fafc; color:#475569;">
                        <tr>
                            <th style="padding:8px; text-align:left; border-bottom:2px solid #cbd5e1;">Subcategoría / Tipo</th>
                            <th style="padding:8px; text-align:left; border-bottom:2px solid #cbd5e1;">Clasificación</th>
                            <th style="padding:8px; text-align:right; border-bottom:2px solid #cbd5e1;">Peso Total</th>
                            <th style="padding:8px; text-align:right; border-bottom:2px solid #cbd5e1;">% del Total</th>
                        </tr>
                    </thead>
                    <tbody>${breakdownRowsHTML || '<tr><td colspan="4" style="padding:15px; text-align:center;">No hay datos para el periodo.</td></tr>'}</tbody>
                </table>
            `;

            // --- PÁGINA 2: GRÁFICOS (SIN CORTES) ---
            const page2 = document.createElement('div');
            page2.style.cssText = pageStyle;
            page2.innerHTML = `
                ${headerHTML}
                <h3 style="color:#1e3a8a; font-size:12pt; border-bottom:1px solid #e2e8f0; padding-bottom:5px; margin-bottom:20px;">2. Evolución Comparativa Histórica</h3>
                <div style="display:flex; flex-direction:column; gap:25px; align-items:center;">
                    <div style="width:100%; border:1px solid #f1f5f9; border-radius:8px; padding:10px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <img src="${imgAssimilable}" style="width:100%; display:block;">
                    </div>
                    <div style="width:100%; border:1px solid #f1f5f9; border-radius:8px; padding:10px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <img src="${imgSpecial}" style="width:100%; display:block;">
                    </div>
                    <div style="width:100%; border:1px solid #f1f5f9; border-radius:8px; padding:10px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <img src="${imgHazardous}" style="width:100%; display:block;">
                    </div>
                </div>
            `;

            // --- PÁGINA 3: BITÁCORAS (INSUMOS Y RETIROS) ---
            const page3 = document.createElement('div');
            page3.style.cssText = pageStyle;
            
            // Helpers para tablas
            const badge = (t) => {
                t = (t||'').toLowerCase();
                if(t.includes('peligroso')) return `<span style="color:#dc2626; font-weight:bold; font-size:8pt;">RP</span>`;
                if(t.includes('especial')) return `<span style="color:#d97706; font-weight:bold; font-size:8pt;">RE</span>`;
                return `<span style="color:#16a34a; font-weight:bold; font-size:8pt;">RSAD</span>`;
            };
            const suppliesHTML = supplies.map(s => `<tr><td style="padding:6px; border-bottom:1px solid #eee;">${formatDate(s.delivery_date)}</td><td style="padding:6px; border-bottom:1px solid #eee;">${s.item_name}</td><td style="padding:6px; border-bottom:1px solid #eee; text-align:center;">${s.quantity_delivered}</td></tr>`).join('');
            const pickupsHTML = pickups.map(p => `<tr><td style="padding:6px; border-bottom:1px solid #eee;">${formatDate(p.pickup_date)}</td><td style="padding:6px; border-bottom:1px solid #eee;">${p.pickup_time?.substring(0,5)}</td><td style="padding:6px; border-bottom:1px solid #eee;">${badge(p.waste_type)}</td><td style="padding:6px; border-bottom:1px solid #eee; font-size:8pt;">${p.observations||'-'}</td><td style="padding:6px; border-bottom:1px solid #eee; font-size:8pt;">${userMap.get(p.user_email?.toLowerCase()) || 'Sistema'}</td></tr>`).join('');

            page3.innerHTML = `
                ${headerHTML}
                <div style="margin-bottom:30px;">
                    <h3 style="color:#1e3a8a; font-size:12pt; border-bottom:1px solid #e2e8f0; padding-bottom:5px; margin-bottom:10px;">3. Gestión de Insumos</h3>
                    <table style="width:100%; border-collapse:collapse; font-size:9pt;">
                        <thead style="background:#f8fafc; font-weight:bold;"><tr><td style="padding:8px;">Fecha</td><td style="padding:8px;">Item</td><td style="padding:8px; text-align:center;">Cant.</td></tr></thead>
                        <tbody>${suppliesHTML || '<tr><td colspan="3" style="padding:10px; text-align:center;">Sin registros.</td></tr>'}</tbody>
                    </table>
                </div>
                <div>
                    <h3 style="color:#1e3a8a; font-size:12pt; border-bottom:1px solid #e2e8f0; padding-bottom:5px; margin-bottom:10px;">4. Bitácora de Retiros</h3>
                    <table style="width:100%; border-collapse:collapse; font-size:9pt;">
                        <thead style="background:#f8fafc; font-weight:bold;"><tr><td style="padding:8px;">Fecha</td><td style="padding:8px;">Hora</td><td style="padding:8px;">Tipo</td><td style="padding:8px;">Obs</td><td style="padding:8px;">Resp.</td></tr></thead>
                        <tbody>${pickupsHTML || '<tr><td colspan="5" style="padding:10px; text-align:center;">Sin retiros.</td></tr>'}</tbody>
                    </table>
                </div>
            `;

            // Agregar páginas al DOM
            masterContainer.appendChild(page1);
            masterContainer.appendChild(page2);
            masterContainer.appendChild(page3);
            document.body.appendChild(masterContainer);

            // 7. GENERACIÓN PDF SECUENCIAL (PÁGINA POR PÁGINA)
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = pdf.internal.pageSize.getHeight();

            // Capturar Página 1
            const canvas1 = await html2canvas(page1, { scale: 2, useCORS: true, logging: false });
            pdf.addImage(canvas1.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pdfW, (canvas1.height * pdfW) / canvas1.width);

            // Capturar Página 2
            pdf.addPage();
            const canvas2 = await html2canvas(page2, { scale: 2, useCORS: true, logging: false });
            pdf.addImage(canvas2.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pdfW, (canvas2.height * pdfW) / canvas2.width);

            // Capturar Página 3
            pdf.addPage();
            const canvas3 = await html2canvas(page3, { scale: 2, useCORS: true, logging: false });
            // Si la tabla es muy larga, aquí podríamos cortar, pero asumimos una hoja por ahora para limpieza
            pdf.addImage(canvas3.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pdfW, (canvas3.height * pdfW) / canvas3.width);

            pdf.save(`Reporte_Gestion_${unitName.replace(/\s+/g, '_')}_${formatDate(startDateInput)}.pdf`);
            document.body.removeChild(masterContainer);

        } catch (err) {
            console.error("Error PDF:", err);
            alert('Error al generar reporte: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };
    const applyWasteFilters = (typeId) => {
        const typeInfo = wasteTypes.find(t => t.id === typeId);
        // ========================================================================
        // INICIO: MODIFICACIÓN DE FILTROS
        // Se añade 'unit_pickups' a la lógica.
        // ========================================================================
        const isPickupTable = typeId === 'unit_pickups';

        const filters = {
            dateStart: document.getElementById(`filter-start-date-${typeId}`).value || null,
            dateEnd: document.getElementById(`filter-end-date-${typeId}`).value || null,
            unitId: Array.from(document.getElementById(`filter-unit-${typeId}`).selectedOptions).map(opt => opt.value),
            wasteTypeSearchTerm: !isPickupTable ? (document.getElementById(`filter-waste-type-${typeId}`)?.value || null) : null,
        };
        
        if(filters.unitId.length === 0) delete filters.unitId;
        if(!filters.wasteTypeSearchTerm) delete filters.wasteTypeSearchTerm;
        
        const tableName = isPickupTable ? 'unit_pickups' : typeInfo.tableName;
        // ========================================================================
        // FIN: MODIFICACIÓN DE FILTROS
        // ========================================================================
        
        const thead = document.querySelector(`#list-${tableName}`).closest('table').querySelector('thead');
        const sort = {
            by: thead.dataset.sortBy,
            asc: thead.dataset.sortAsc === 'true'
        };
        loadAndRenderList(tableName, 0, filters, sort);
    };
    
    const clearWasteFilters = (typeId) => {
        document.getElementById(`filter-start-date-${typeId}`).value = '';
        document.getElementById(`filter-end-date-${typeId}`).value = '';
        document.getElementById(`filter-unit-${typeId}`).selectedIndex = -1;
        
        // Limpiar filtro de tipo de residuo solo si existe
        if (typeId !== 'unit_pickups') {
            const wasteTypeInput = document.getElementById(`filter-waste-type-${typeId}`);
            if(wasteTypeInput) wasteTypeInput.value = '';
        }
        
        applyWasteFilters(typeId);
    };

    const setupEventListeners = () => {
        const tabsContainer = document.querySelector('.waste-tab-btn')?.parentElement;
        if (!tabsContainer) return;
        tabsContainer.addEventListener('click', (e) => {
            const tabButton = e.target.closest('.waste-tab-btn');
            if (!tabButton) return;
            const tabId = tabButton.dataset.tabId;
            tabsContainer.querySelectorAll('.waste-tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.waste-tab-content').forEach(content => content.classList.add('hidden'));
            tabButton.classList.add('active');
            document.getElementById(`tab-content-${tabId}`).classList.remove('hidden');
        });
        
        // Esto ahora incluye los botones de las pestañas Y los de la tabla 'unit_pickups'
        document.querySelectorAll('.apply-filters-btn').forEach(btn => {
            btn.addEventListener('click', () => applyWasteFilters(btn.dataset.typeId));
        });
        document.querySelectorAll('.clear-filters-btn').forEach(btn => {
            btn.addEventListener('click', () => clearWasteFilters(btn.dataset.typeId));
        });
    };

    return { init };
})();
// =================================================================================
// FIN: MÓDULO DE GESTIÓN DE RESIDUOS
// =================================================================================

// ---------------------------------------------------------------------------------
// PARTE 6: ORQUESTACIÓN Y ARRANQUE DE LA APP
// ---------------------------------------------------------------------------------

/**
 * Loads the content of a tab/module into the main area.
 * @param {string} tabName - The name of the module to load (e.g., 'dashboard').
 */
function loadTabContent(tabName) {
    const contentArea = document.getElementById('main-content');
    if (!contentArea) return;
    contentArea.innerHTML = `<div class="flex justify-center items-center p-10"><div class="loader"></div><p class="mt-4 text-gray-500">Cargando...</p></div>`;

    const module = window.APP_MODULES[tabName];

    if (module && typeof module.init === 'function') {
        setTimeout(() => module.init(contentArea), 50);
    } else {
        console.error(`Error: Module '${tabName}' not found or has no init method.`);
        contentArea.innerHTML = `<div class="text-center p-10 bg-red-100 rounded-lg"><p>Error al cargar el módulo '${tabName}'. Verifique que el módulo está definido en app.js</p></div>`;
    }
}
window.loadAndRenderList = loadAndRenderList;


/**
 * Populates the navigation bar with items from the config.
 */
function injectNavStyles() {
    const styleId = 'pro-nav-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        /* Scrollbar invisible para el menú pero funcional */
        .nav-scroll::-webkit-scrollbar { width: 4px; }
        .nav-scroll::-webkit-scrollbar-track { background: transparent; }
        .nav-scroll::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.3); border-radius: 10px; }
        .nav-scroll:hover::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.5); }

        /* Animaciones de los items */
        .nav-item {
            position: relative;
            transition: all 0.2s ease-in-out;
        }
        .nav-item::before {
            content: '';
            position: absolute;
            left: -12px;
            top: 50%;
            transform: translateY(-50%);
            height: 0%;
            width: 3px;
            background-color: #4f46e5; /* Indigo 600 */
            border-radius: 0 4px 4px 0;
            transition: height 0.2s ease;
            opacity: 0;
        }
        .nav-item.active::before {
            height: 70%;
            opacity: 1;
        }
        
        /* Efecto Glassmorphism sutil para el activo */
        .nav-item.active {
            background-color: #eff6ff; /* Blue 50 */
            color: #2563eb; /* Blue 600 */
        }
        .nav-item:hover:not(.active) {
            background-color: #f9fafb; /* Gray 50 */
            color: #1f2937; /* Gray 800 */
        }
        
        /* Títulos de grupo */
        .nav-group-title {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #9ca3af; /* Gray 400 */
            font-weight: 700;
            margin-top: 1.5rem;
            margin-bottom: 0.5rem;
            padding-left: 0.75rem;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Populates the navigation bar with a modern, grouped layout.
 */
function populateNavbar() {
    injectNavStyles(); // Aseguramos que los estilos estén cargados
    const nav = document.getElementById('main-nav');
    if (!nav) return;

    // Definimos los grupos lógicos para el menú
    const groups = {
        main: { title: 'General', items: ['dashboard', 'estadisticas'] },
        operational: { title: 'Operaciones', items: ['waste', 'recycling', 'unit_pickups', 'inventory', 'wastePoints', 'equipment'] },
        admin: { title: 'Administración', items: ['agreements', 'users', 'settings'] }
    };

    // Convertimos la configuración plana en un mapa para acceso rápido
    const configMap = window.APP_CONFIG.navItems.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
    }, {});

    let html = `<div class="nav-scroll flex flex-col h-full overflow-y-auto px-3 pb-4 space-y-1">`;

    // Iteramos sobre los grupos para generar el HTML
    Object.keys(groups).forEach((key, index) => {
        const group = groups[key];
        // Filtramos los items que realmente existen en la configuración (por permisos de usuario)
        const groupItems = group.items.map(id => configMap[id]).filter(Boolean);

        if (groupItems.length > 0) {
            // Título del grupo (oculto en el primer grupo para más minimalismo, opcional)
            html += `<div class="nav-group-title">${group.title}</div>`;

            groupItems.forEach(item => {
                html += `
                <a href="#" class="tab-btn nav-item flex items-center px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 group transition-colors mb-0.5" data-tab="${item.id}" title="${item.text}">
                    <span class="flex-shrink-0 w-5 h-5 mr-3 transition-colors group-hover:text-gray-900 opacity-70 group-hover:opacity-100">
                        ${item.icon}
                    </span>
                    <span class="truncate">${item.text}</span>
                    ${key === 'main' && item.id === 'dashboard' ? '<span class="ml-auto w-2 h-2 bg-red-500 rounded-full hidden md:block" title="Alertas"></span>' : ''}
                </a>`;
            });
            
            // Separador visual sutil entre grupos (excepto el último)
            if (index < Object.keys(groups).length - 1) {
                html += `<div class="my-2 border-b border-dashed border-gray-200 mx-2"></div>`;
            }
        }
    });

    html += `</div>`;
    nav.innerHTML = html;
    
    // Aseguramos que el contenedor padre tenga el estilo correcto
    nav.className = "flex-1 overflow-hidden"; 
}

function setupTabs() {
    const nav = document.getElementById('main-nav');
    if (nav) {
        nav.addEventListener('click', (e) => {
            // Buscamos el elemento con la clase .tab-btn (que ahora también tiene .nav-item)
            const tabButton = e.target.closest('.tab-btn');
            if (tabButton) {
                e.preventDefault();
                
                // Remover clase active de todos los botones
                nav.querySelectorAll('.tab-btn').forEach(t => {
                    t.classList.remove('active', 'bg-blue-50', 'text-blue-600');
                    t.classList.add('text-gray-600'); // Restaurar color inactivo
                });
                
                // Añadir clase active al botón clickeado
                tabButton.classList.add('active'); 
                // Eliminamos clases de texto gris para que el CSS de .active tome control, 
                // o forzamos con clases de utilidad si Tailwind tiene prioridad:
                tabButton.classList.remove('text-gray-600');
                
                loadTabContent(tabButton.dataset.tab);
                
                // En móvil, si tienes un menú lateral que se cierra, aquí iría la lógica.
            }
        });

        // Activar la primera pestaña por defecto
        const firstTab = nav.querySelector('.tab-btn');
        if (firstTab) {
            firstTab.classList.add('active');
            firstTab.classList.remove('text-gray-600');
        }
    }
}
/**
 * Sets up the user profile area with email and logout button.
 */
async function setupUserProfile() {
    const userProfileEl = document.getElementById('user-profile');
    const session = await window.Auth.getSession();
    if (session && userProfileEl) {
        const email = session.user && session.user.email ? session.user.email : null;
        const name = session.user && session.user.name ? session.user.name : '';
        if (!email && !name) {
            return;
        }
        // Elegimos la inicial del nombre si está disponible, en caso contrario la del correo
        const initial = name ? name.charAt(0).toUpperCase() : (email ? email.charAt(0).toUpperCase() : '?');
        // Mostramos el nombre si existe; de lo contrario, mostramos el correo
        const displayName = name || email;
        userProfileEl.innerHTML = `<div class="flex items-center p-2 rounded-lg"><div class="w-8 h-8 rounded-full bg-indigo-200 flex items-center justify-center font-bold text-indigo-600 text-sm" title="${displayName}">${initial}</div><div class="ml-3 hidden lg:block"><p class="text-sm font-semibold text-gray-700 truncate max-w-[150px]" title="${displayName}">${displayName}</p><button id="logout-btn" class="text-xs text-red-600 hover:underline">Cerrar Sesión</button></div></div>`;
        document.getElementById('logout-btn').addEventListener('click', () => window.Auth.signOut());
    }
}

/**
 * Main function that orchestrates the app startup.
 */
async function mainApp() {
    await Promise.all([loadUnitsCache(), loadSuppliesCache(), loadEquipmentCache(), loadAgreementsCache()]);

    // Obtenemos la sesión actual para determinar los permisos del usuario.
    const session = await window.Auth.getSession();
    // Clonamos el array de navegación original para evitar modificar la configuración global si no es necesario.
    let filteredNav = window.APP_CONFIG.navItems;
    if (session && session.user) {
        const email = session.user.email || '';
        // Si el usuario no es el administrador declarado, eliminamos la entrada de "usuarios" del menú.
        if (email.toLowerCase() !== 'mcadiz@it.ucsc.cl') {
            filteredNav = window.APP_CONFIG.navItems.filter(item => item.id !== 'users');
        }
    }
    // Sobrescribimos temporalmente la configuración de navegación con el menú filtrado.
    window.APP_CONFIG.navItems = filteredNav;

    populateNavbar();
    setupTabs();
    await setupUserProfile();

    loadTabContent('dashboard');
}


/**
 * Entry point of the application. Executes when the DOM is fully loaded.
 */
document.addEventListener('DOMContentLoaded', async () => {
    if (document.body.id !== 'login-page') {
        try {
            const logoUrl = 'logo-hpl.png'; 
            window.APP_CONFIG.HOSPITAL_LOGO_BASE64 = await imageToBase64(logoUrl);
        } catch (e) {
            console.error("Could not load hospital logo for reports.");
        }
        
        window.Auth.checkAuth().then(async session => {
            if (session) {
                // Intentar obtener el email del usuario. Si no viene en la sesión, solicitarlo a Supabase.
                let email = null;
                if (session.user && session.user.email) {
                    email = session.user.email;
                } else if (authToken && currentClientKey) {
                    try {
                        const userInfo = await supabaseRequest(currentClientKey, '/auth/v1/user', 'GET');
                        email = userInfo && userInfo.email ? userInfo.email : null;
                    } catch (e) {
                        email = null;
                    }
                }
                // Obtener rol desde la tabla perfiles; por defecto auxiliar
                let role = 'auxiliar';
                if (email) {
                    try {
                        const params = `select=rol&email=eq.${encodeURIComponent(email)}&limit=1`;
                        const perfilData = await supabaseRequest(currentClientKey, '/rest/v1/perfiles', 'GET', null, params);
                        if (Array.isArray(perfilData) && perfilData.length > 0 && perfilData[0].rol) {
                            role = perfilData[0].rol;
                        }
                    } catch (e) {
                        // Si falla la consulta, se mantiene el rol auxiliar
                    }
                }
                const currentPath = window.location.pathname;

                if (role === 'auxiliar') {
                    // Si es auxiliar y NO está en registro.html, forzar redirección
                    if (!currentPath.includes('registro.html')) {
                        window.location.href = 'registro.html';
                        return;
                    }
                    // Si ya está en registro.html, NO ejecutar mainApp() (registro.js se encarga)
                    return;
                } else {
                    // Si es administrador y está en registro.html, enviarlo al index (opcional)
                    if (currentPath.includes('registro.html')) {
                        window.location.href = 'index.html';
                        return;
                    }
                    // Si es admin y está en el dashboard, ejecutar la app principal
                    mainApp();
                }
            }
        });
    }
});
// -------------------------------------------------------------------------
// PARTE FINAL: DEFINICIÓN DE FUNCIÓN parseAndAdd PARA COMPATIBILIDAD
// -------------------------------------------------------------------------
/**
 * Algunas versiones antiguas del generador de reportes hacían referencia a
 * parseAndAdd() durante la construcción del PDF. Para mantener la
 * compatibilidad y evitar errores de referencia, definimos aquí un stub
 * vacío. En la implementación actual ya no se utiliza, pero esta función
 * garantiza que cualquier llamada residual no genere excepciones.
 */
if (typeof window.parseAndAdd !== 'function') {
    window.parseAndAdd = function() {
        // función de compatibilidad; no realiza ninguna acción
    };
}