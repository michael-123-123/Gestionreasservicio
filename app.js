// =================================================================================
// GESTIÓNPRO - SCRIPT CENTRAL MULTI-ESTABLECIMIENTO (APP.JS)
// Versión 28.0: Gráficos de Informe Mejorados y Detalle de Establecimiento.
//
// DESCRIPCIÓN:
// Esta versión introduce gráficos detallados en los informes de establecimiento para
// Residuos Asimilables (RSAD) y subcategorías de Residuos Especiales. Además,
// en la vista de administrador, el resumen ejecutivo ahora especifica el hospital
// de las unidades con mayor generación.
//
// CAMBIOS:
// 1. (NUEVO) Gráfico de RSAD por Unidad: El informe de establecimiento ahora
//    incluye un gráfico de barras que muestra las unidades que más residuos
//    asimilables generan.
// 2. (NUEVO) Gráfico de Tendencia de R. Especiales: Se añade un gráfico de
//    barras apiladas para visualizar la evolución mensual de cada subcategoría
//    de residuo especial en el informe.
// 3. (MEJORADO) Detalle de Hospital en Resumen: El resumen ejecutivo del informe
//    consolidado (admin) ahora muestra el nombre del hospital junto al nombre
//    de la unidad en los rankings de mayor generación.
// 4. (CORREGIDO) No se mostraba correctamente la subcategoría de especiales en
//    el informe, se añade gráfico para mayor visibilidad.
// =================================================================================


// ---------------------------------------------------------------------------------
// PARTE 1: CONFIGURACIÓN Y CLIENTES DE SUPABASE
// ---------------------------------------------------------------------------------

const SUPABASE_URL_SST = 'https://mddxfoldoxtofjvevmfg.supabase.co';
const SUPABASE_ANON_KEY_SST = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kZHhmb2xkb3h0b2ZqdmV2bWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3ODY3NjQsImV4cCI6MjA3MTM2Mjc2NH0.qgWe16qCy42PpvM10xZDT2Nxzvv3VL-rI4xyZjxROEg';
const supabaseSST = window.supabase.createClient(SUPABASE_URL_SST, SUPABASE_ANON_KEY_SST);

const SUPABASE_URL_HPL = 'https://awnyfetnjoaffqchaofv.supabase.co';
const SUPABASE_ANON_KEY_HPL = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3bnlmZXRuam9hZmZxY2hhb2Z2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3NjA5MzAsImV4cCI6MjA2NTMzNjkzMH0.uV_rSurPAEg79d-czQq7qL3FfnNJhoYxMJ20JyDYNog';
const supabaseHPL = window.supabase.createClient(SUPABASE_URL_HPL, SUPABASE_ANON_KEY_HPL);

const supabaseClients = {
    sst: { client: supabaseSST, name: 'SST' },
    hpl: { client: supabaseHPL, name: 'HPL' }
};
window.supabase = supabaseSST;

// ---------------------------------------------------------------------------------
// PARTE 2: ESTADO GLOBAL DE LA APLICACIÓN Y CACHÉ
// ---------------------------------------------------------------------------------
let appState = {
    user: null,
    profile: null,
    establishment: null,
    unitsCache: [],
    suppliesCache: [],
    agreementsCache: [],
    allEstablishments: [],
    globalEstablishmentFilter: 'all',
    currentClient: supabaseSST,
    globalListFilters: {} // Almacena filtros y ahora también el ordenamiento
};

// ---------------------------------------------------------------------------------
// PARTE 3: MÓDULO DE AUTENTICACIÓN
// ---------------------------------------------------------------------------------
const Auth = {
    async signUp(credentials) {
        const { data, error } = await supabaseSST.auth.signUp(credentials);
        if (error) return error;
        await supabaseSST.from('perfiles').insert([{ id: data.user.id, email: data.user.email }]);
        window.location.href = 'index.html';
        return null;
    },
    async signIn(credentials) {
        const { error } = await supabaseSST.auth.signInWithPassword(credentials);
        if (!error) window.location.href = 'index.html';
        return error;
    },
    async signOut() {
        await supabaseSST.auth.signOut();
        window.location.href = 'login.html';
    },
    async fetchUserProfile() {
        const { data: { session } } = await supabaseSST.auth.getSession();
        if (!session) throw new Error("No active session.");
        
        appState.user = session.user;

        let { data: profile, error } = await supabaseSST
            .from('perfiles')
            .select('*, establecimiento:establecimientos(id, nombre)')
            .eq('id', session.user.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                console.log("Profile not found, creating a new one.");
                const { error: insertError } = await supabaseSST.from('perfiles').insert([{ id: session.user.id, email: session.user.email }]);
                if (insertError) throw new Error("Failed to create user profile: " + insertError.message);
                return this.fetchUserProfile();
            } else {
                throw new Error("Failed to fetch user profile: " + error.message);
            }
        }
        
        appState.profile = profile;
        if (profile.establecimiento) {
            appState.establishment = { ...profile.establecimiento, source: 'sst' };
        } else {
             const isHPLUser = profile.rol && profile.rol.toLowerCase().includes('hpl');
             if(isHPLUser) {
                appState.establishment = { id: 1, nombre: 'Hospital Penco Lirquén', source: 'hpl' };
             } else {
                appState.establishment = null;
             }
        }
        
        if (profile.rol === 'admin') {
            const [source] = appState.globalEstablishmentFilter.split(/-(.+)/);
            appState.currentClient = getSupabaseClient(source);
        } else if (appState.establishment) {
            appState.currentClient = getSupabaseClient(appState.establishment.source);
        } else {
            appState.currentClient = supabaseSST;
        }
        
        return profile;
    },
    async checkAuth() {
        try {
            return await this.fetchUserProfile();
        } catch (error) {
            console.error("Authentication check failed:", error.message);
            if (!window.location.pathname.endsWith('/login.html')) {
                window.location.href = 'login.html';
            }
            return null;
        }
    },
    async updateProfile(userId, updates) {
        const { error } = await supabaseSST.from('perfiles').update(updates).eq('id', userId);
        return error;
    }
};
window.Auth = Auth;

// ---------------------------------------------------------------------------------
// PARTE 4: CONFIGURACIÓN GLOBAL Y DATOS
// ---------------------------------------------------------------------------------
window.APP_CONFIG = {
    RECORDS_PER_PAGE: 25,
    wasteTypeOptions: {
        special_waste_categories: {
            'CORTO-PUNZANTES': 'A.1',
            'CULTIVOS Y MUESTRAS ALMACENADAS': 'A.2',
            'PATOLOGICOS': 'A.3',
            'RESTOS DE ANIMALES': 'A.4',
            'SANGRE Y PRODUCTOS DERIVADOS': 'A.5'
        }
    },
    tableHeaders: {
        units: ['name', 'building', 'floor', 'description'],
        supplies: ['item_name', 'description'],
        supply_arrivals: ['arrival_date', 'supply_name', 'quantity_arrived', 'notes'],
        supply_deliveries: ['delivery_date', 'supply_name', 'unit_name', 'quantity_delivered', 'notes'],
        hazardous_waste: ['date', 'weight_kg', 'waste_type', 'unit_name', 'container_type'],
        special_waste: ['date', 'weight_kg', 'waste_type', 'unit_name', 'container_type'],
        assimilable_waste: ['date', 'weight_kg', 'unit_name'],
        radioactive_waste: ['date', 'weight_kg', 'waste_type', 'unit_name'],
        containers: ['container_reference', 'container_type', 'waste_usage_type', 'capacity_liters', 'unit_name'],
        waste_removal_agreements: ['razon_social', 'rut_proveedor', 'licitacion_id', 'price_per_kg_special_iva', 'price_per_kg_hazardous_iva', 'price_per_kg_assimilable_iva', 'price_per_kg_radioactive_iva', 'start_date', 'end_date', 'status'],
        monthly_invoices: ['purchase_order_number', 'agreement_razon_social', 'billing_cycle_start', 'billing_cycle_end', 'pre_invoice_kg_special', 'pre_invoice_kg_hazardous', 'pre_invoice_amount_iva', 'status'],
    },
    headerTranslations: {
        date: 'Fecha',
        weight_kg: 'Peso (kg)',
        waste_type: 'Categoría / Tipo',
        unit_id: 'Unidad',
        unit_name: 'Nombre Unidad',
        container_reference: 'Referencia/Lugar',
        capacity_liters: 'Capacidad (L)',
        container_type: 'Tipo de Contenedor',
        item_name: 'Insumo',
        description: 'Descripción',
        razon_social: 'Razón Social',
        rut_proveedor: 'RUT',
        licitacion_id: 'ID Licitación',
        start_date: 'Inicio Contrato',
        end_date: 'Fin Contrato',
        status: 'Estado',
        name: 'Nombre',
        building: 'Edificio',
        floor: 'Piso',
        supply_id: 'Insumo',
        supply_name: 'Nombre Insumo',
        quantity_delivered: 'Cant. Entregada',
        quantity_arrived: 'Cant. Recibida',
        delivery_date: 'Fecha Entrega',
        arrival_date: 'Fecha Recepción',
        notes: 'Notas',
        agreement_id: 'Convenio',
        agreement_razon_social: 'Razón Social Convenio',
        purchase_order_number: 'N° Orden de Compra',
        billing_cycle_start: 'Inicio Ciclo',
        billing_cycle_end: 'Fin Ciclo',
        price_per_kg_special_iva: 'Precio Kg Especial (IVA incl.)',
        price_per_kg_hazardous_iva: 'Precio Kg Peligroso (IVA incl.)',
        price_per_kg_assimilable_iva: 'Precio Kg Asimilable (IVA incl.)',
        price_per_kg_radioactive_iva: 'Precio Kg Radiactivo (IVA incl.)',
        waste_usage_type: 'Uso para Residuo',
        pre_invoice_kg_special: 'Kg Especial Prefactura',
        pre_invoice_kg_hazardous: 'Kg Peligroso Prefactura',
        pre_invoice_amount_iva: 'Valor Prefactura (IVA incl.)',
        establecimiento_id: 'Establecimiento'
    },
    navItems: [
        { id: 'dashboard', icon: '<i class="fas fa-chart-pie"></i>', text: 'Dashboard' },
        { id: 'estadisticas', icon: '<i class="fas fa-chart-line"></i>', text: 'Análisis y Estadísticas' },
        { id: 'waste', icon: '<i class="fas fa-trash-alt"></i>', text: 'Residuos' },
        { id: 'inventory', icon: '<i class="fas fa-boxes"></i>', text: 'Inventario' },
        { id: 'wastePoints', icon: '<i class="fas fa-map-marker-alt"></i>', text: 'Puntos Residuos' },
        { id: 'agreements', icon: '<i class="fas fa-file-signature"></i>', text: 'Convenios' },
        { id: 'settings', icon: '<i class="fas fa-cog"></i>', text: 'Configuración' }
    ]
};
window.APP_MODULES = {};

// ---------------------------------------------------------------------------------
// PARTE 5: LÓGICA DE DATOS MULTI-BBDD (ADAPTATIVA)
// ---------------------------------------------------------------------------------

function getSupabaseClient(source) {
    return supabaseClients[source]?.client || supabaseSST;
}

async function fetchFromAllDBs(tableName, selectStringFn) {
    const promises = Object.entries(supabaseClients).map(async ([source, { client, name }]) => {
        try {
            const selectString = selectStringFn(source);
            const { data, error } = await client.from(tableName).select(selectString);
            if (error) {
                if (error.code === '42P01' || error.code === 'PGRST002' || (error.details && error.details.includes('does not exist'))) {
                    console.warn(`Tabla '${tableName}' no encontrada en ${name}. Se omitirá.`);
                    return [];
                }
                console.error(`Error fetching ${tableName} from ${name}:`, error);
                return [];
            }
            return data.map(item => ({ ...item, source, hospitalName: name }));
        } catch (e) {
            console.error(`A critical error occurred while fetching ${tableName} from ${name}:`, e);
            return [];
        }
    });

    const results = await Promise.all(promises);
    return results.flat();
}

async function loadUnitsCache() {
    const selectFn = (source) => {
        return source === 'hpl' ? 'id, name, building, floor' : 'id, name, building, floor, establecimiento_id';
    };

    if (appState.profile.rol === 'admin') {
        appState.unitsCache = await fetchFromAllDBs('units', selectFn);
    } else if (appState.establishment) {
        const client = getSupabaseClient(appState.establishment.source);
        const selectString = selectFn(appState.establishment.source);
        let query = client.from('units').select(selectString);
        if(appState.establishment.source === 'sst'){
            query = query.eq('establecimiento_id', appState.establishment.id);
        }
        const { data } = await query.order('name');
        appState.unitsCache = (data || []).map(u => ({ ...u, source: appState.establishment.source, hospitalName: supabaseClients[appState.establishment.source].name }));
    }
}

async function loadSuppliesCache() {
    const selectFn = (source) => {
        return source === 'hpl' ? 'id, item_name' : 'id, item_name, establecimiento_id';
    };

    if (appState.profile.rol === 'admin') {
        appState.suppliesCache = await fetchFromAllDBs('supplies', selectFn);
    } else if (appState.establishment) {
        const client = getSupabaseClient(appState.establishment.source);
        const selectString = selectFn(appState.establishment.source);
         let query = client.from('supplies').select(selectString);
        if(appState.establishment.source === 'sst'){
            query = query.eq('establecimiento_id', appState.establishment.id);
        }
        const { data } = await query.order('item_name');
        appState.suppliesCache = (data || []).map(s => ({ ...s, source: appState.establishment.source, hospitalName: supabaseClients[appState.establishment.source].name }));
    }
}

async function loadAgreementsCache() {
    const selectFn = (source) => {
        return source === 'hpl' ? '*' : '*, establecimiento:establecimientos(id, nombre)';
    };

    if (appState.profile.rol === 'admin') {
        appState.agreementsCache = await fetchFromAllDBs('waste_removal_agreements', selectFn);
    } else if (appState.establishment) {
        const client = getSupabaseClient(appState.establishment.source);
        const selectString = selectFn(appState.establishment.source);
        let query = client.from('waste_removal_agreements').select(selectString);
        if(appState.establishment.source === 'sst'){
            query = query.eq('establecimiento_id', appState.establishment.id);
        }
        const { data } = await query.order('razon_social');
        appState.agreementsCache = (data || []).map(a => ({ ...a, source: appState.establishment.source, hospitalName: supabaseClients[appState.establishment.source].name }));
    }
}

async function loadAllEstablishments() {
    if (appState.profile.rol === 'admin') {
        try {
            const { data: sstData, error: sstErr } = await supabaseSST.from('establecimientos').select('id, nombre');
            
            if (sstErr) {
                console.error('Error cargando establecimientos de SST:', sstErr);
            }
            
            const hplData = [{ id: 1, nombre: 'Hospital Penco Lirquén' }];

            const list = [];
            if (Array.isArray(sstData)) {
                list.push(...sstData.map(e => ({ ...e, source: 'sst', hospitalName: 'SST' })));
            }
             if (Array.isArray(hplData)) {
                list.push(...hplData.map(e => ({ ...e, source: 'hpl', hospitalName: 'HPL' })));
            }
            
            appState.allEstablishments = list.sort((a, b) => {
                if (a.hospitalName === b.hospitalName) return a.nombre.localeCompare(b.nombre);
                return a.hospitalName.localeCompare(b.hospitalName);
            });
        } catch (err) {
            console.error('Error crítico cargando establecimientos:', err);
            appState.allEstablishments = [];
        }
    }
}

async function fetchAll(queryBuilder) {
    const BATCH_SIZE = 1000;
    let allData = [];
    let from = 0;
    while (true) {
        const { data, error } = await queryBuilder.range(from, from + BATCH_SIZE - 1);
        if (error) {
            console.error("Error fetching paginated data:", error);
            throw error;
        }
        if (data && data.length > 0) {
            allData = allData.concat(data);
            from += BATCH_SIZE;
        } else {
            break;
        }
        if (!data || data.length < BATCH_SIZE) {
            break;
        }
    }
    return allData;
}

const calcVariation = (current, previous) => {
    if (previous === 0 && current > 0) return Infinity;
    if (previous === 0 && current === 0) return 0;
    if (previous === null || current === null || previous === undefined || current === undefined) return 0;
    return ((current - previous) / previous) * 100;
};
window.calcVariation = calcVariation;

// ---------------------------------------------------------------------------------
// PARTE 6: FUNCIONES CRUD, FILTROS Y ORDENAMIENTO DE TABLAS
// ---------------------------------------------------------------------------------

function makeTableSortable(table, tableName) {
    const header = table.querySelector('thead');
    if (!header) return;

    header.addEventListener('click', e => {
        const th = e.target.closest('th[data-sort-key]');
        if (!th) return;

        const sortKey = th.dataset.sortKey;
        const currentSort = appState.globalListFilters.sort || {};
        let newSortOrder = 'desc';

        if (currentSort.key === sortKey && currentSort.order === 'desc') {
            newSortOrder = 'asc';
        }
        
        appState.globalListFilters.sort = { key: sortKey, order: newSortOrder };

        loadAndRenderList(tableName, 0, appState.globalListFilters);
    });
}


function createFilterInterface(tableNames) {
    const today = new Date().toISOString().split('T')[0];
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const startDate = oneMonthAgo.toISOString().split('T')[0];
    
    let establishmentFilterHTML = '';
    if(appState.profile.rol === 'admin') {
        const establishmentOptions = appState.allEstablishments.map(e => `<option value="${e.source}-${e.id}">${e.nombre}</option>`).join('');
        establishmentFilterHTML = `
            <div>
                <label class="font-medium text-sm">Establecimiento</label>
                <select id="filter-establishment" class="form-input mt-1">
                    <option value="all">Todos</option>
                    ${establishmentOptions}
                </select>
            </div>
        `;
    }

    let unitsInView = appState.unitsCache;
    const unitOptions = unitsInView.map(u => `<option value="${u.id}">${u.name}</option>`).join('');

    return `
        <div class="section-card mb-6" id="filters-for-${tableNames.join('-')}">
            <h3 class="text-lg font-semibold mb-3">Filtros</h3>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                ${establishmentFilterHTML}
                <div>
                    <label class="font-medium text-sm">Fecha Inicio</label>
                    <input type="date" id="filter-start-date" class="form-input mt-1" value="${startDate}">
                </div>
                <div>
                    <label class="font-medium text-sm">Fecha Fin</label>
                    <input type="date" id="filter-end-date" class="form-input mt-1" value="${today}">
                </div>
                <div class="${appState.profile.rol === 'admin' ? '' : 'md:col-span-2'}">
                    <label class="font-medium text-sm">Unidades</label>
                    <select id="filter-units" class="form-input mt-1" multiple>${unitOptions}</select>
                </div>
            </div>
            <div class="mt-4">
                <button id="apply-list-filters-btn" class="btn btn-primary btn-sm">Aplicar Filtros</button>
                <button id="clear-list-filters-btn" class="btn btn-secondary btn-sm">Limpiar</button>
            </div>
        </div>
    `;
}

function setupFilterListeners(tableNames) {
    const establishmentFilter = document.getElementById('filter-establishment');
    if(establishmentFilter) {
        establishmentFilter.addEventListener('change', () => {
            const establishmentValue = establishmentFilter.value;
            const unitSelect = document.getElementById('filter-units');
            let unitsInView = appState.unitsCache;
            if(establishmentValue !== 'all') {
                const [source, estId] = establishmentValue.split(/-(.+)/);
                unitsInView = appState.unitsCache.filter(u => u.source === source && (source === 'hpl' || String(u.establecimiento_id) === String(estId)));
            }
            unitSelect.innerHTML = unitsInView.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
        });
    }

    document.getElementById('apply-list-filters-btn').addEventListener('click', () => {
        const estFilter = document.getElementById('filter-establishment');
        appState.globalListFilters = {
            startDate: document.getElementById('filter-start-date').value,
            endDate: document.getElementById('filter-end-date').value,
            unitIds: Array.from(document.getElementById('filter-units').selectedOptions).map(opt => opt.value),
            establishment: estFilter ? estFilter.value : 'all',
            sort: appState.globalListFilters.sort
        };
        tableNames.forEach(tableName => loadAndRenderList(tableName, 0, appState.globalListFilters));
    });

    document.getElementById('clear-list-filters-btn').addEventListener('click', () => {
        const estFilter = document.getElementById('filter-establishment');
        if(estFilter) estFilter.value = 'all';
        document.getElementById('filter-start-date').value = '';
        document.getElementById('filter-end-date').value = '';
        document.getElementById('filter-units').selectedIndex = -1;
        if(estFilter) document.getElementById('filter-units').innerHTML = appState.unitsCache.map(u => `<option value="${u.id}">${u.name}</option>`).join('');

        appState.globalListFilters = {};
        tableNames.forEach(tableName => loadAndRenderList(tableName, 0, {}));
    });
}


async function setupCRUD(tableName, singularName) {
    const form = document.getElementById(`form-${tableName}`);
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true; button.innerHTML = '<span>Guardando...</span>';

            const formData = new FormData(form);
            let record = Object.fromEntries(formData.entries());

            let client;
            let source;
            const formEstId = record.establecimiento_id;

            if (appState.profile.rol === 'admin' && formEstId) {
                [source] = formEstId.split(/-(.+)/);
                client = getSupabaseClient(source);
            } else if (appState.profile.rol !== 'admin' && appState.establishment) {
                source = appState.establishment.source;
                client = getSupabaseClient(source);
            } else {
                client = appState.currentClient;
                source = Object.keys(supabaseClients).find(s => supabaseClients[s].client === client) || 'sst';
            }

            const directLinkTables = ['units', 'supplies', 'waste_removal_agreements'];
            if (source === 'sst' && formEstId && directLinkTables.includes(tableName)) {
                const [_, estId] = formEstId.split(/-(.+)/);
                record.establecimiento_id = estId;
            } else if (record.establecimiento_id) {
                delete record.establecimiento_id;
            }

            Object.keys(record).forEach(k => { if (record[k] === '' || record[k] === null) delete record[k]; });
            
            if(record.weight_kg) record.weight_kg = parseFloat(record.weight_kg);

            const { error } = await client.from(tableName).insert([record]).select();

            if (error) {
                console.error('Error en inserción:', error);
                alert(`Error al añadir en ${supabaseClients[source].name}: ${error.message}`);
            } else {
                form.reset();
                if(form.querySelector('#form-establishment-selector')){
                    const unitSelect = form.querySelector('select[name="unit_id"]');
                    if(unitSelect) unitSelect.innerHTML = `<option value="">Seleccione primero un establecimiento</option>`;
                }
                if (form.parentElement.tagName === 'DETAILS') form.parentElement.open = false;
                await loadAndRenderList(tableName, 0, appState.globalListFilters);
                if (document.getElementById('dashboard-container')) await window.APP_MODULES.dashboard.loadDashboardData();
            }
            button.disabled = false; button.innerHTML = `Añadir ${singularName}`;
        });
    }

    const uploadInput = document.getElementById(`csv-upload-${tableName}`);
    if (uploadInput) {
        uploadInput.addEventListener('change', (e) => handleCSVUpload(e, tableName));
    }
    const downloadLink = document.getElementById(`csv-download-${tableName}`);
    if (downloadLink) {
        downloadLink.addEventListener('click', (e) => {
            e.preventDefault();
            downloadCSVExample(tableName);
        });
    }

    await loadAndRenderList(tableName, 0, appState.globalListFilters);
}

function getSelectStringForTable(tableName, source) {
    const sstSelects = {
        'hazardous_waste': `*, units(id, name, building, floor, establecimiento_id, establecimiento:establecimientos(id, nombre))`,
        'special_waste': `*, units(id, name, building, floor, establecimiento_id, establecimiento:establecimientos(id, nombre))`,
        'assimilable_waste': `*, units(id, name, building, floor, establecimiento_id, establecimiento:establecimientos(id, nombre))`,
        'radioactive_waste': `*, units(id, name, building, floor, establecimiento_id, establecimiento:establecimientos(id, nombre))`,
        'containers': `*, units:units(id, name, building, floor, establecimiento:establecimientos(id, nombre))`,
        'supply_deliveries': `*, supplies:supplies(item_name), units:units(id, name, building, floor, establecimiento:establecimientos(id, nombre))`,
        'supply_arrivals': '*, supplies:supplies(item_name, establecimiento:establecimientos(id, nombre))',
        'monthly_invoices': '*, agreement:waste_removal_agreements(razon_social, establecimiento:establecimientos(id, nombre))',
        'units': '*, establecimiento:establecimientos(id, nombre)',
        'supplies': '*, establecimiento:establecimientos(id, nombre)',
        'waste_removal_agreements': '*, establecimiento:establecimientos(id, nombre)'
    };

    const hplSelects = {
        'hazardous_waste': `*, units(id, name, building, floor)`,
        'special_waste': `*, units(id, name, building, floor)`,
        'assimilable_waste': `*, units(id, name, building, floor)`,
        'containers': `*, units:units(id, name, building, floor)`,
        'supply_deliveries': `*, supplies:supplies(item_name), units:units(id, name, building, floor)`,
        'supply_arrivals': '*, supplies:supplies(item_name)',
        'monthly_invoices': '*, agreement:waste_removal_agreements(razon_social)',
        'units': '*',
        'supplies': '*',
        'waste_removal_agreements': '*'
    };

    if (source === 'hpl') {
        return hplSelects[tableName] || '*';
    }
    return sstSelects[tableName] || '*';
}

async function loadAndRenderList(tableName, page = 0, filters = {}) {
    const listContainer = document.getElementById(`list-${tableName}`);
    if (!listContainer) return;
    
    const tableWrapper = listContainer.closest('.overflow-x-auto');
    let loader;
    if (tableWrapper) {
        tableWrapper.style.position = 'relative';
        loader = document.createElement('div');
        loader.className = 'absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10';
        loader.innerHTML = '<div class="loader"></div>';
        loader.id = `loader-for-${tableName}`;
        tableWrapper.appendChild(loader);
    } else {
        listContainer.innerHTML = `<tr><td colspan="100%" class="text-center p-4">Cargando...</td></tr>`;
    }

    try {
        const from = page * window.APP_CONFIG.RECORDS_PER_PAGE;
        const to = from + window.APP_CONFIG.RECORDS_PER_PAGE - 1;

        let data = [], error = null, count = 0;

        const getEstablishmentContext = () => {
            if(appState.profile.rol !== 'admin') {
                return { source: appState.establishment.source, id: appState.establishment.id };
            }
            if(filters.establishment && filters.establishment !== 'all') {
                const [source, id] = filters.establishment.split(/-(.+)/);
                return { source, id };
            }
            if(appState.globalEstablishmentFilter !== 'all') {
                 const [source, id] = appState.globalEstablishmentFilter.split(/-(.+)/);
                return { source, id };
            }
            return { source: 'all', id: null };
        };

        const context = getEstablishmentContext();
        
        const applyFiltersToQuery = (query, filters, source, tableName) => {
            let dateColumn = 'date';
            if (tableName === 'supply_arrivals') dateColumn = 'arrival_date';
            if (tableName === 'supply_deliveries') dateColumn = 'delivery_date';

            if (filters.startDate) query = query.gte(dateColumn, filters.startDate);
            if (filters.endDate) query = query.lte(dateColumn, filters.endDate);
            
            if(filters.unitIds && filters.unitIds.length > 0) {
                const sourceUnitIds = appState.unitsCache
                    .filter(u => u.source === source && filters.unitIds.includes(String(u.id)))
                    .map(u => u.id);
                if(tableName.includes('waste') || tableName === 'containers' || tableName === 'supply_deliveries'){
                    query = sourceUnitIds.length > 0 ? query.in('unit_id', sourceUnitIds) : query.eq('unit_id', -1);
                }
            }
            return query;
        };
        
        const sortOptions = filters.sort || { key: 'created_at', order: 'desc' };

        if (context.source === 'all') { // Admin global view
            const promises = Object.entries(supabaseClients).map(async ([source, { client, name }]) => {
                if (tableName === 'radioactive_waste' && source === 'hpl') return { data: [], error: null, count: 0 };
                try {
                    const selectString = getSelectStringForTable(tableName, source);
                    let query = client.from(tableName).select(selectString, { count: 'exact' });
                    query = applyFiltersToQuery(query, filters, source, tableName);
                    
                    const { data, error, count } = await query.order(sortOptions.key, { ascending: sortOptions.order === 'asc' }).range(from, to);
                    if (error && error.code !== '42P01') console.error(`Error loading ${tableName} from ${name}:`, error);
                    return { data: (data || []).map(item => ({ ...item, source, hospitalName: name })), error, count };
                } catch (e) {
                    console.error(`Critical error loading ${tableName} from ${name}:`, e);
                    return { data: [], error: e, count: 0 };
                }
            });
            const results = await Promise.all(promises);
            data = results.flatMap(r => r.data);
            count = results.reduce((acc, r) => acc + (r.count || 0), 0);
            error = results.find(r => r.error && r.error.code !== '42P01')?.error;
        } else { // Single establishment view
            const { source, id: establishmentIdToFilter } = context;
            const client = getSupabaseClient(source);
            const selectString = getSelectStringForTable(tableName, source);
            let query = client.from(tableName).select(selectString, { count: 'exact' });

            if (establishmentIdToFilter) {
                if (source === 'sst') {
                    const tableHasEstId = ['units', 'supplies', 'waste_removal_agreements'].includes(tableName);
                    if (tableHasEstId) query = query.eq('establecimiento_id', establishmentIdToFilter);
                    else if (tableName.includes('waste') || tableName === 'containers' || tableName === 'supply_deliveries') query = query.eq('units.establecimiento_id', establishmentIdToFilter);
                    else if (tableName === 'supply_arrivals') query = query.eq('supplies.establecimiento_id', establishmentIdToFilter);
                     else if (tableName === 'monthly_invoices') query = query.eq('agreement.establecimiento_id', establishmentIdToFilter);
                }
            }
            
            query = applyFiltersToQuery(query, filters, source, tableName);

            const { data: resultData, error: resultError, count: resultCount } = await query
                .order(sortOptions.key, { ascending: sortOptions.order === 'asc' })
                .range(from, to);
                
            data = (resultData || []).map(item => ({ ...item, source, hospitalName: supabaseClients[source].name }));
            error = resultError;
            count = resultCount || 0;
        }

        if (error && data.length === 0) {
            listContainer.innerHTML = `<tr><td colspan="100%" class="text-center p-4 text-red-500">Error: ${error.message}.</td></tr>`;
            return;
        }
        if (data.length === 0) {
            listContainer.innerHTML = `<tr><td colspan="100%" class="text-center p-4 text-gray-500">No hay registros que coincidan con los filtros.</td></tr>`;
            renderPaginationControls(tableName, 0, 0, filters);
            return;
        }

        listContainer.innerHTML = '';
        const displayHeaders = window.APP_CONFIG.tableHeaders[tableName].map(h => {
            if (tableName === 'supplies' && h === 'item_name') return h;
            if (h === 'unit_name') return 'unit_id';
            if (h === 'supply_name') return 'supply_id';
            if (h === 'agreement_razon_social') return 'agreement_id';
            return h.replace('_name', '_id').replace('_razon_social', '_id');
        });
        data.forEach(item => listContainer.appendChild(renderItem(item, tableName, context.source === 'all', displayHeaders)));
        
        const tableElement = listContainer.closest('table');
        if (tableElement) {
            makeTableSortable(tableElement, tableName);
        }
        
        const sortableColumns = {
            units: ['name', 'building', 'floor'],
            supplies: ['item_name'],
            supply_arrivals: ['arrival_date', 'quantity_arrived'],
            supply_deliveries: ['delivery_date', 'quantity_delivered'],
            hazardous_waste: ['date', 'weight_kg', 'waste_type'],
            special_waste: ['date', 'weight_kg', 'waste_type'],
            assimilable_waste: ['date', 'weight_kg'],
            radioactive_waste: ['date', 'weight_kg', 'waste_type'],
            containers: ['container_reference', 'container_type', 'waste_usage_type', 'capacity_liters'],
            waste_removal_agreements: ['razon_social', 'rut_proveedor', 'start_date', 'end_date', 'status'],
            monthly_invoices: ['billing_cycle_start', 'billing_cycle_end', 'pre_invoice_kg_special', 'pre_invoice_kg_hazardous', 'pre_invoice_amount_iva', 'status'],
        };

        const tableHeadersContainer = listContainer.parentElement.querySelector('thead tr');
        if (tableHeadersContainer) {
            let headersHTML = displayHeaders.map(h => {
                const isSortable = (sortableColumns[tableName] || []).includes(h);
                let sortIcon = '';
                if (isSortable && sortOptions.key === h) {
                    sortIcon = ` <i class="fas fa-arrow-${sortOptions.order === 'asc' ? 'up' : 'down'} sort-icon"></i>`;
                }
                return `<th class="px-3 py-3 text-center" ${isSortable ? `data-sort-key="${h}" style="cursor: pointer;"` : ''}>
                            ${window.APP_CONFIG.headerTranslations[h] || h}${sortIcon}
                        </th>`;
            }).join('');

            if (context.source === 'all') {
                headersHTML += `<th class="px-3 py-3 text-center">Establecimiento</th>`;
            }
            headersHTML += `<th class="px-3 py-3 text-center">Acciones</th>`;
            tableHeadersContainer.innerHTML = headersHTML;
        }

        renderPaginationControls(tableName, page, count, filters);
    } finally {
        if (loader) {
            loader.remove();
        }
    }
}

function renderPaginationControls(tableName, currentPage, totalRecords, filters = {}) {
    const paginationContainer = document.getElementById(`pagination-${tableName}`);
    if (!paginationContainer) return;
    const totalPages = Math.ceil(totalRecords / window.APP_CONFIG.RECORDS_PER_PAGE);
    paginationContainer.innerHTML = '';
    if (totalPages <= 1) return;

    const prevButton = document.createElement('button');
    prevButton.textContent = 'Anterior';
    prevButton.className = 'btn btn-secondary btn-sm';
    prevButton.disabled = currentPage === 0;
    prevButton.addEventListener('click', () => loadAndRenderList(tableName, currentPage - 1, filters));

    const pageInfo = document.createElement('span');
    pageInfo.className = 'text-sm text-gray-600';
    pageInfo.textContent = `Página ${currentPage + 1} de ${totalPages}`;

    const nextButton = document.createElement('button');
    nextButton.textContent = 'Siguiente';
    nextButton.className = 'btn btn-secondary btn-sm';
    nextButton.disabled = currentPage >= totalPages - 1;
    nextButton.addEventListener('click', () => loadAndRenderList(tableName, currentPage + 1, filters));

    paginationContainer.append(prevButton, pageInfo, nextButton);
}

function renderItem(item, tableName, isAdminGlobalView, headers) {
    const tr = document.createElement('tr');
    tr.className = 'border-b hover:bg-gray-50';
    let cells = '';

    headers.forEach(header => {
        let cellValue = item[header] ?? 'N/A';
        if (header === 'unit_id' && item.units) cellValue = item.units.name;
        if (header === 'supply_id' && item.supplies) cellValue = item.supplies.item_name;
        if (header === 'agreement_id' && item.agreement) cellValue = item.agreement.razon_social;
        
        const dateHeaders = ['date', 'arrival_date', 'delivery_date', 'billing_cycle_start', 'billing_cycle_end'];
        if (dateHeaders.includes(header) && cellValue && cellValue !== 'N/A') {
            const date = new Date(cellValue);
            if (!isNaN(date.getTime())) {
                cellValue = new Date(date.getTime() + date.getTimezoneOffset() * 60000).toLocaleDateString('es-CL');
            }
        }
        
        if (typeof cellValue === 'string' && cellValue.length > 30) {
            cellValue = `<span title="${cellValue}">${cellValue.substring(0, 30)}...</span>`;
        }

        cells += `<td class="py-2 px-3 text-sm text-center">${cellValue}</td>`;
    });

    if (isAdminGlobalView) {
        let establishmentName = 'N/A';
        if (tableName === 'units' && item.establecimiento?.nombre) {
            establishmentName = item.establecimiento.nombre;
        } else if (tableName === 'units' && item.source === 'hpl') {
            establishmentName = 'Hospital Penco Lirquén';
        } else if (item.units?.establecimiento?.nombre) {
            establishmentName = item.units.establecimiento.nombre;
        } else if (item.agreement?.establecimiento?.nombre) {
            establishmentName = item.agreement.establecimiento.nombre;
        } else if (item.hospitalName) {
            establishmentName = item.hospitalName === 'HPL' ? 'Hospital Penco Lirquén' : 'Red SST';
        }
        cells += `<td class="py-2 px-3 text-sm text-center">${establishmentName}</td>`;
    }

    cells += `<td class="py-2 px-3 flex items-center justify-center space-x-2"><button onclick="openEditModal('${tableName}', '${item.id}', '${item.source}')" class="text-blue-600 hover:text-blue-800" title="Editar"><i class="fas fa-edit"></i></button><button onclick="deleteItem('${tableName}', '${item.id}', '${item.source}')" class="text-red-600 hover:text-red-800" title="Eliminar"><i class="fas fa-trash"></i></button></td>`;
    tr.innerHTML = cells;
    return tr;
}

window.deleteItem = async function (tableName, id, source) {
    if (!confirm(`¿Estás seguro de que quieres eliminar este registro? Esta acción no se puede deshacer.`)) return;
    const client = getSupabaseClient(source);
    const { error } = await client.from(tableName).delete().match({ id });
    if (error) {
        alert(`Error al eliminar: ${error.message}`);
    } else {
        await loadAndRenderList(tableName, 0, appState.globalListFilters);
        if (document.getElementById('dashboard-container')) {
            await window.APP_MODULES.dashboard.loadDashboardData();
        }
    }
}

window.openEditModal = async function (tableName, id, source) {
    const client = getSupabaseClient(source);
    const modalContainer = document.getElementById('modal-container');
    modalContainer.classList.remove('hidden');
    modalContainer.innerHTML = `<div class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center">
        <div class="bg-white rounded-lg p-8 shadow-xl max-w-2xl w-full modal-content overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-bold">Editar Registro</h2>
                <button onclick="closeModal()" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>
            </div>
            <div id="edit-form-container" class="loader-container"><div class="loader"></div></div>
        </div>
    </div>`;

    const { data, error } = await client.from(tableName).select('*').eq('id', id).single();
    if (error) {
        alert("Error al cargar los datos para editar: " + error.message);
        closeModal();
        return;
    }

    const formFieldsHTML = await getFormFields(tableName, data);
    const formContainer = document.getElementById('edit-form-container');
    formContainer.innerHTML = `
        <form id="edit-form" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${formFieldsHTML}
            <div class="md:col-span-2 flex justify-end gap-2 mt-4">
                <button type="button" onclick="closeModal()" class="btn btn-secondary">Cancelar</button>
                <button type="submit" class="btn btn-primary">Guardar Cambios</button>
            </div>
        </form>
    `;

    document.getElementById('edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button[type="submit"]');
        button.disabled = true; button.textContent = 'Guardando...';

        const formData = new FormData(e.target);
        const updates = Object.fromEntries(formData.entries());

        Object.keys(updates).forEach(k => { if (updates[k] === '') delete updates[k]; });
        if(updates.weight_kg) updates.weight_kg = parseFloat(updates.weight_kg);

        const { error: updateError } = await client.from(tableName).update(updates).eq('id', id);

        if (updateError) {
            alert("Error al actualizar: " + updateError.message);
            button.disabled = false; button.textContent = 'Guardar Cambios';
        } else {
            closeModal();
            await loadAndRenderList(tableName, 0, appState.globalListFilters);
            if (document.getElementById('dashboard-container')) {
                await window.APP_MODULES.dashboard.loadDashboardData();
            }
        }
    });
}

window.closeModal = function () {
    const modalContainer = document.getElementById('modal-container');
    if (modalContainer) {
        modalContainer.classList.add('hidden');
        modalContainer.innerHTML = '';
    }
}

// ---------------------------------------------------------------------------------
// PARTE 7: GENERACIÓN DINÁMICA DE FORMULARIOS Y CSV
// ---------------------------------------------------------------------------------

async function getFormFields(tableName, data = {}) {
    const headers = window.APP_CONFIG.tableHeaders[tableName] || [];
    let html = '';

    const isWasteTable = tableName.includes('_waste');
    if (appState.profile.rol === 'admin' && isWasteTable) {
        const establishmentOptions = appState.allEstablishments.map(e => `<option value="${e.source}-${e.id}">${e.nombre}</option>`).join('');
        html += `
            <div class="md:col-span-full">
                <label class="font-medium">Establecimiento</label>
                <select name="establecimiento_id" id="form-establishment-selector" class="form-input mt-1" required>
                    <option value="">Seleccione un establecimiento...</option>
                    ${establishmentOptions}
                </select>
            </div>`;
    }

    for (const field of headers.filter(h => !['created_at', 'id'].includes(h))) {
        html += await getFormFieldHTML(tableName, field, data[field] || '', data);
    }
    return html;
}

async function getWasteCategories(tableName) {
    const promises = Object.values(supabaseClients).map(({ client, name }) => {
        if(name === 'HPL' && tableName === 'radioactive_waste') return Promise.resolve({ data: [] });
        return client.from(tableName).select('waste_type');
    });
    const results = await Promise.all(promises);
    const allTypes = results.flatMap(res => (res.data || []).map(item => item.waste_type));
    return [...new Set(allTypes)].sort();
}


async function getFormFieldHTML(tableName, field, value) {
    const T = window.APP_CONFIG.headerTranslations;
    const originalField = field.replace('_name', '_id').replace('_razon_social', '_id');
    let label = T[field] || field;

    let unitsForSelect = [];
    if (appState.profile.rol === 'admin') {
         unitsForSelect = [];
    } else if (appState.establishment) {
        unitsForSelect = appState.unitsCache.filter(u => u.source === appState.establishment.source);
    }

    if (originalField === 'unit_id') {
        const optionsHTML = unitsForSelect.map(u => `<option value="${u.id}" ${u.id == value ? 'selected' : ''}>${u.name}</option>`).join('');
        const initialMessage = appState.profile.rol === 'admin' ? '<option value="">Seleccione primero un establecimiento</option>' : optionsHTML;
        return `<div><label class="font-medium">${label}</label><select name="unit_id" class="form-input mt-1" required>${initialMessage}</select></div>`;
    }
    
    if (originalField === 'supply_id') {
        let suppliesForSelect = appState.suppliesCache;
         if (appState.profile.rol !== 'admin' && appState.establishment) {
            suppliesForSelect = appState.suppliesCache.filter(s => s.source === appState.establishment.source);
         }
        return `<div><label class="font-medium">${label}</label><select name="supply_id" class="form-input mt-1" required>${suppliesForSelect.map(s => `<option value="${s.id}" ${s.id == value ? 'selected' : ''}>${s.item_name}</option>`).join('')}</select></div>`;
    }
    if (originalField === 'agreement_id') {
        let agreementsForSelect = appState.agreementsCache;
        if(appState.profile.rol !== 'admin' && appState.establishment){
            agreementsForSelect = appState.agreementsCache.filter(a => a.source === appState.establishment.source);
        }
        return `<div><label class="font-medium">${label}</label><select name="agreement_id" class="form-input mt-1" required><option value="">Seleccione...</option>${agreementsForSelect.map(a => `<option value="${a.id}" ${a.id == value ? 'selected' : ''}>${a.razon_social}</option>`).join('')}</select></div>`;
    }
    if (field === 'status' && ['waste_removal_agreements', 'monthly_invoices'].includes(tableName)) {
        const options = tableName === 'monthly_invoices' ? ['Pendiente', 'Validado', 'Disputado'] : ['Vigente', 'Expirado', 'Por Renovar'];
        return `<div><label class="font-medium">${label}</label><select name="status" class="form-input mt-1">${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    }
    if (tableName === 'containers' && field === 'waste_usage_type') {
        const options = ['Peligrosos', 'Especiales (REAS)', 'Radiactivos', 'Asimilables'];
        return `<div><label class="font-medium">${label}</label><select name="waste_usage_type" class="form-input mt-1">${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    }

    if ((tableName === 'special_waste' || tableName === 'hazardous_waste' || tableName === 'radioactive_waste') && field === 'waste_type') {
        const categories = await getWasteCategories(tableName);
        const datalistOptions = categories.map(cat => `<option value="${cat}">`).join('');
        return `<div><label class="font-medium">${label}</label><input type="text" name="${field}" value="${value}" class="form-input mt-1" required list="waste-type-list-${tableName}">
                    <datalist id="waste-type-list-${tableName}">${datalistOptions}</datalist></div>`;
    }

    if (field.includes('description') || field.includes('notes')) {
        return `<div><label class="font-medium">${label}</label><textarea name="${field}" class="form-input mt-1" rows="3">${value}</textarea></div>`;
    }

    let inputType = 'text';
    const dateFields = ['date', 'arrival_date', 'delivery_date', 'billing_cycle_start', 'billing_cycle_end'];
    if (dateFields.includes(originalField)) inputType = 'date';
    if (field.includes('kg') || field.includes('quantity') || field.includes('price') || field.includes('amount') || field.includes('liters')) inputType = 'number';

    const isRequired = ['date', 'weight_kg', 'item_name', 'name', 'razon_social', 'rut_proveedor', 'arrival_date', 'delivery_date'].includes(originalField);
    const valueAttr = `value="${value}"`;

    return `<div><label class="font-medium">${label}</label><input type="${inputType}" name="${originalField}" ${valueAttr} class="form-input mt-1" ${inputType === 'number' ? 'step="any"' : ''} ${isRequired ? 'required' : ''}></div>`;
}

function createCSVInterface(tableName, singularName) {
    return `
        <div class="flex-grow">
            <details>
                <summary class="btn btn-secondary btn-sm cursor-pointer">Carga Masiva (${singularName})</summary>
                <div class="mt-4 p-4 bg-gray-50 rounded-lg">
                    <p class="text-sm text-gray-600 mb-2">Sube un archivo CSV para añadir múltiples registros. Asegúrate de que las columnas coincidan con la plantilla.</p>
                    <div class="flex gap-2">
                        <input type="file" id="csv-upload-${tableName}" accept=".csv" class="hidden"/>
                        <label for="csv-upload-${tableName}" class="btn btn-primary btn-sm"><i class="fas fa-upload mr-2"></i>Cargar CSV</label>
                        <button id="csv-download-${tableName}" class="btn btn-success btn-sm"><i class="fas fa-download mr-2"></i>Descargar Ejemplo</button>
                    </div>
                </div>
            </details>
        </div>`;
}

function downloadCSVExample(tableName) {
    const headers = window.APP_CONFIG.tableHeaders[tableName];
    const examples = {
        'units': [
            { name: 'Pabellón 1', building: 'Central', floor: '2', description: 'Ala norte' },
            { name: 'Laboratorio', building: 'Anexo A', floor: '1', description: 'Toma de muestras' }
        ],
        'supplies': [
            { item_name: 'Guantes de Nitrilo', description: 'Caja de 100 unidades' },
            { item_name: 'Contenedor Cortopunzante 1L', description: 'Plástico rígido' }
        ],
        'special_waste': [
            { date: '2025-01-15', weight_kg: '12.5', waste_type: 'CORTO-PUNZANTES', unit_name: 'Pabellón 1', container_type: 'Contenedor Rígido' },
            { date: '2025-01-16', weight_kg: '5.2', waste_type: 'SANGRE Y PRODUCTOS DERIVADOS', unit_name: 'Laboratorio', container_type: 'Bolsa Roja' }
        ],
        'monthly_invoices': [
            { purchase_order_number: 'OC-2025-001', agreement_razon_social: 'Bio-Residuos S.A.', billing_cycle_start: '2025-01-01', billing_cycle_end: '2025-01-31', pre_invoice_kg_special: '150.5', pre_invoice_kg_hazardous: '25.2', pre_invoice_amount_iva: '180000', status: 'Pendiente' },
            { purchase_order_number: 'OC-2025-002', agreement_razon_social: 'Salud Ambiental Ltda.', billing_cycle_start: '2025-01-01', billing_cycle_end: '2025-01-31', pre_invoice_kg_special: '320.0', pre_invoice_kg_hazardous: '80.7', pre_invoice_amount_iva: '450000', status: 'Validado' }
        ]
    };

    const exampleData = examples[tableName] || [Object.fromEntries(headers.map(h => [h, '']))];
    const csvContent = Papa.unparse(exampleData, { header: true });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `ejemplo_${tableName}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function handleCSVUpload(event, tableName) {
    const file = event.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            const data = results.data;
            let successCount = 0;
            let errorCount = 0;
            let errorMessages = [];

            const recordsToInsert = [];

            let client = supabaseSST;
            let source = 'sst';

            if (appState.profile.rol === 'admin' && appState.globalEstablishmentFilter !== 'all') {
                const [filterSource, _] = appState.globalEstablishmentFilter.split('-');
                source = filterSource;
                client = getSupabaseClient(source);
            } else if (appState.profile.rol !== 'admin' && appState.establishment) {
                source = appState.establishment.source;
                client = getSupabaseClient(source);
            }

            for (const row of data) {
                let record = { ...row };
                let hasError = false;

                if (record.unit_name) {
                    const unit = appState.unitsCache.find(u => u.name.toLowerCase() === record.unit_name.toLowerCase() && u.source === source);
                    if (unit) record.unit_id = unit.id;
                    else { hasError = true; errorMessages.push(`Fila ${successCount + errorCount + 1}: No se encontró la unidad "${record.unit_name}" en ${supabaseClients[source].name}.`); }
                    delete record.unit_name;
                }
                if (record.supply_name) {
                    const supply = appState.suppliesCache.find(s => s.item_name.toLowerCase() === record.supply_name.toLowerCase() && s.source === source);
                    if (supply) record.supply_id = supply.id;
                    else { hasError = true; errorMessages.push(`Fila ${successCount + errorCount + 1}: No se encontró el insumo "${record.supply_name}" en ${supabaseClients[source].name}.`); }
                    delete record.supply_name;
                }
                if (record.agreement_razon_social) {
                    const agreement = appState.agreementsCache.find(a => a.razon_social.toLowerCase() === record.agreement_razon_social.toLowerCase() && a.source === source);
                    if (agreement) record.agreement_id = agreement.id;
                    else { hasError = true; errorMessages.push(`Fila ${successCount + errorCount + 1}: No se encontró el convenio "${record.agreement_razon_social}" en ${supabaseClients[source].name}.`); }
                    delete record.agreement_razon_social;
                }
                const directLinkTables = ['units', 'supplies', 'waste_removal_agreements'];
                if (source === 'sst' && appState.establishment?.id && directLinkTables.includes(tableName)) {
                     record.establecimiento_id = appState.establishment.id;
                }

                if (hasError) {
                    errorCount++;
                } else {
                    recordsToInsert.push(record);
                }
            }

            if (recordsToInsert.length > 0) {
                const { error } = await client.from(tableName).insert(recordsToInsert);
                if (error) {
                    alert(`Error al guardar los datos del CSV en ${supabaseClients[source].name}: ${error.message}`);
                    errorCount += recordsToInsert.length;
                } else {
                    successCount = recordsToInsert.length;
                }
            }

            let summary = `Carga de CSV completada.\n\nRegistros exitosos: ${successCount}\nRegistros con errores: ${errorCount}`;
            if (errorMessages.length > 0) {
                summary += "\n\nDetalle de errores:\n" + errorMessages.slice(0, 5).join('\n');
                if (errorMessages.length > 5) summary += "\n(y más...)";
            }
            alert(summary);

            await loadAndRenderList(tableName, 0);
            event.target.value = '';
        }
    });
}

// ---------------------------------------------------------------------------------
// PARTE 8: MÓDULOS DE LA APLICACIÓN (VISTAS)
// ---------------------------------------------------------------------------------

// =================================================================================
// INICIO: MÓDULO DE DASHBOARD CON GENERADOR DE INFORMES AVANZADO
// =================================================================================
window.APP_MODULES.dashboard = (() => {
    let wasteTrendChart = null;
    let wasteCompositionChart = null;
    let dashboardDataCache = null;

    const init = async (container) => {
        container.innerHTML = `
            <div id="dashboard-container">
                <div class="flex justify-between items-center mb-6">
                    <h1 class="text-3xl font-bold text-gray-800">Dashboard y Reportes</h1>
                </div>

                <div class="section-card mb-8">
                    <h2 class="text-xl font-semibold mb-4">Generador de Informes</h2>
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div><label class="font-medium text-sm">Año del Informe</label><select id="report-year-filter" class="form-input mt-1"><option>Cargando...</option></select></div>
                        <div><label class="font-medium text-sm">Tipo de Periodo</label><select id="report-type" class="form-input mt-1"><option>Bimestral</option><option>Trimestral</option><option>Semestral</option></select></div>
                        <div><label class="font-medium text-sm">Periodo Específico</label><select id="report-period-select" class="form-input mt-1"></select></div>
                        <button id="generate-report-btn" class="btn btn-primary w-full">Generar Informe</button>
                    </div>
                </div>

                <div id="report-output-wrapper" class="hidden mb-8">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-2xl font-semibold">Vista Previa del Informe</h2>
                        <button id="download-pdf-btn" class="btn btn-success hidden"><i class="fas fa-file-pdf mr-2"></i>Descargar PDF</button>
                    </div>
                    <div id="report-output" class="bg-gray-200 p-4 rounded-lg overflow-y-auto" style="max-height: 80vh;"></div>
                </div>

                <div class="section-card mb-8">
                     <div class="flex items-center gap-4">
                         <label class="font-medium text-sm">Año del Dashboard</label>
                         <select id="dashboard-year-filter" class="form-input w-40"></select>
                     </div>
                </div>

                <div id="kpi-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    ${Array(4).fill('<div class="kpi-card-placeholder"></div>').join('')}
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div class="section-card"><h2 id="waste-trend-chart-title" class="text-xl font-semibold mb-4">Tendencia de Generación (kg)</h2><div class="relative h-80"><canvas id="wasteTrendChart"></canvas></div></div>
                    <div class="section-card"><h2 class="text-xl font-semibold mb-4">Composición de Residuos (kg)</h2><div class="relative h-80"><canvas id="wasteCompositionChart"></canvas></div></div>
                </div>
            </div>`;

        document.getElementById('report-year-filter').addEventListener('change', updatePeriodSelector);
        document.getElementById('report-type').addEventListener('change', updatePeriodSelector);
        document.getElementById('generate-report-btn').addEventListener('click', generateProfessionalReport);
        document.getElementById('download-pdf-btn').addEventListener('click', downloadReportAsPDF);
        document.getElementById('dashboard-year-filter').addEventListener('change', loadDashboardData);

        await populateDynamicYearFilter();
        updatePeriodSelector();
        loadDashboardData();
    };

    const populateDynamicYearFilter = async () => {
        const reportYearFilter = document.getElementById('report-year-filter');
        const dashboardYearFilter = document.getElementById('dashboard-year-filter');
        if (!reportYearFilter || !dashboardYearFilter) return;

        const allYears = new Set();
        const sstPromise = supabaseSST.from('special_waste').select('date');
        const hplPromise = supabaseHPL.from('special_waste').select('date');
        const [sstResult, hplResult] = await Promise.all([sstPromise, hplPromise]);
        
        if (sstResult.data) sstResult.data.forEach(r => allYears.add(new Date(r.date).getUTCFullYear()));
        if (hplResult.data) hplResult.data.forEach(r => allYears.add(new Date(r.date).getUTCFullYear()));
        
        const years = Array.from(allYears).sort((a, b) => b - a);

        if (years.length === 0) {
            const currentYear = new Date().getFullYear();
            years.push(currentYear);
        }

        const optionsHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
        reportYearFilter.innerHTML = optionsHTML;
        dashboardYearFilter.innerHTML = optionsHTML;
    };

    const loadDashboardData = async () => {
        if (!appState.profile) {
            console.error("Dashboard data cannot be loaded because user profile is not available.");
            const kpiContainer = document.getElementById('kpi-container');
            if (kpiContainer) {
                kpiContainer.innerHTML = `<p class="lg:col-span-4 text-center text-red-500">No se pudo cargar el perfil del usuario. Intente recargar la página.</p>`;
            }
            return;
        }
        
        const year = document.getElementById('dashboard-year-filter').value;
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        const wasteData = await getWasteDataForPeriod(new Date(startDate), new Date(endDate));
        dashboardDataCache = wasteData;
        
        renderKPIs();
        renderWasteCharts();
    };

    const renderKPIs = () => {
        const kpiContainer = document.getElementById('kpi-container');
        if (!kpiContainer || !dashboardDataCache) return;
        const { special, hazardous, assimilable, radioactive } = dashboardDataCache;
        const totalSpecial = special.reduce((sum, r) => sum + (parseFloat(r.weight_kg) || 0), 0);
        const totalHazardous = hazardous.reduce((sum, r) => sum + (parseFloat(r.weight_kg) || 0), 0);
        const totalAssimilable = assimilable.reduce((sum, r) => sum + (parseFloat(r.weight_kg) || 0), 0);
        const totalRadioactive = radioactive.reduce((sum, r) => sum + (parseFloat(r.weight_kg) || 0), 0);

        kpiContainer.innerHTML = `
            <div class="kpi-card"><div class="flex items-center"><div class="kpi-icon yellow"><i class="fas fa-biohazard"></i></div><div class="ml-4"><p class="text-gray-500">Especiales (Año)</p><p class="text-2xl font-bold">${totalSpecial.toFixed(2)} kg</p></div></div></div>
            <div class="kpi-card"><div class="flex items-center"><div class="kpi-icon indigo"><i class="fas fa-triangle-exclamation"></i></div><div class="ml-4"><p class="text-gray-500">Peligrosos (Año)</p><p class="text-2xl font-bold">${totalHazardous.toFixed(2)} kg</p></div></div></div>
            <div class="kpi-card"><div class="flex items-center"><div class="kpi-icon green"><i class="fas fa-recycle"></i></div><div class="ml-4"><p class="text-gray-500">Asimilables (Año)</p><p class="text-2xl font-bold">${totalAssimilable.toFixed(2)} kg</p></div></div></div>
            <div class="kpi-card"><div class="flex items-center"><div class="kpi-icon purple"><i class="fas fa-radiation"></i></div><div class="ml-4"><p class="text-gray-500">Radiactivos (Año)</p><p class="text-2xl font-bold">${totalRadioactive.toFixed(2)} kg</p></div></div></div>`;
    };

    const renderWasteCharts = () => {
		if (!dashboardDataCache) return;

		const trendCtx = document.getElementById('wasteTrendChart')?.getContext('2d');
		const compositionCtx = document.getElementById('wasteCompositionChart')?.getContext('2d');
		if (!trendCtx || !compositionCtx) return;

		const { special, hazardous, assimilable, radioactive } = dashboardDataCache;
		const isGlobalAdminView = appState.profile.rol === 'admin' && appState.globalEstablishmentFilter === 'all';
		
		if (wasteTrendChart) wasteTrendChart.destroy();
		
		// Gráfico de Tendencia
		const trendTitleEl = document.getElementById('waste-trend-chart-title');
		if (isGlobalAdminView) {
			trendTitleEl.textContent = 'Generación Mensual por Establecimiento (kg)';
			const labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
			const allWaste = [...special, ...hazardous, ...assimilable, ...radioactive];
			
			const monthlyDataByEst = {};
			appState.allEstablishments.forEach(e => {
				const key = e.source === 'hpl' ? 'Hospital Penco Lirquén' : e.nombre;
				monthlyDataByEst[key] = Array(12).fill(0);
			});
			
			allWaste.forEach(r => {
				const month = new Date(r.date + 'T00:00:00').getUTCMonth();
                const est = appState.allEstablishments.find(e => {
                    if (r.source === 'hpl') return e.source === 'hpl';
                    return e.source === 'sst' && String(e.id) === String(r.units?.establecimiento_id);
                });
                const estKey = est ? (est.source === 'hpl' ? 'Hospital Penco Lirquén' : est.nombre) : r.source.toUpperCase();

				if (monthlyDataByEst[estKey]) {
					monthlyDataByEst[estKey][month] += parseFloat(r.weight_kg || 0);
				}
			});

			const establishmentColors = ['#4f46e5', '#818cf8', '#f59e0b', '#fbbf24', '#10b981', '#6ee7b7', '#ef4444', '#f87171'];
			const datasets = Object.entries(monthlyDataByEst).map(([estName, data], index) => ({
				label: estName,
				data: data,
				backgroundColor: establishmentColors[index % establishmentColors.length],
			}));

			wasteTrendChart = new Chart(trendCtx, {
				type: 'bar',
				data: { labels, datasets },
				options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true },
                        y: { stacked: true, beginAtZero: true }
                    }
                }
			});

		} else {
			trendTitleEl.textContent = 'Tendencia de Generación (kg)';
			const labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
			const data = { special: Array(12).fill(0), hazardous: Array(12).fill(0), assimilable: Array(12).fill(0), radioactive: Array(12).fill(0) };
			
			special.forEach(r => { data.special[new Date(r.date + 'T00:00:00').getUTCMonth()] += parseFloat(r.weight_kg || 0); });
			hazardous.forEach(r => { data.hazardous[new Date(r.date + 'T00:00:00').getUTCMonth()] += parseFloat(r.weight_kg || 0); });
			assimilable.forEach(r => { data.assimilable[new Date(r.date + 'T00:00:00').getUTCMonth()] += parseFloat(r.weight_kg || 0); });
			radioactive.forEach(r => { data.radioactive[new Date(r.date + 'T00:00:00').getUTCMonth()] += parseFloat(r.weight_kg || 0); });
			
			wasteTrendChart = new Chart(trendCtx, {
				type: 'line',
				data: {
					labels,
					datasets: [
						{ label: 'Especiales',  data: data.special,     borderColor: '#f59e0b', backgroundColor: '#f59e0b20', fill: true, tension: 0.3 },
						{ label: 'Peligrosos',  data: data.hazardous,   borderColor: '#ef4444', backgroundColor: '#ef444420', fill: true, tension: 0.3 },
						{ label: 'Asimilables (RSAD)', data: data.assimilable, borderColor: '#22c55e', backgroundColor: '#22c55e20', fill: true, tension: 0.3 },
						{ label: 'Radiactivos', data: data.radioactive, borderColor: '#8b5cf6', backgroundColor: '#8b5cf620', fill: true, tension: 0.3 }
					]
				},
				options: { responsive: true, maintainAspectRatio: false }
			});
		}

		// Gráfico de Composición
		if (wasteCompositionChart) wasteCompositionChart.destroy();
		const totalSpecial = special.reduce((sum, r) => sum + (parseFloat(r.weight_kg) || 0), 0);
		const totalHazardous = hazardous.reduce((sum, r) => sum + (parseFloat(r.weight_kg) || 0), 0);
		const totalAssimilable = assimilable.reduce((sum, r) => sum + (parseFloat(r.weight_kg) || 0), 0);
		const totalRadioactive = radioactive.reduce((sum, r) => sum + (parseFloat(r.weight_kg) || 0), 0);

		wasteCompositionChart = new Chart(compositionCtx, {
			type: 'doughnut',
			data: {
				labels: ['Especiales', 'Peligrosos', 'Asimilables', 'Radiactivos'],
				datasets: [{ data: [totalSpecial, totalHazardous, totalAssimilable, totalRadioactive], backgroundColor: ['#f59e0b', '#ef4444', '#22c55e', '#8b5cf6'] }]
			},
			options: { responsive: true, maintainAspectRatio: false }
		});
	};

    const generateProfessionalReport = async () => {
        const btn = document.getElementById('generate-report-btn');
        btn.disabled = true;
        btn.innerHTML = `<div class="loader !w-5 !h-5 !border-2 mr-2"></div> Generando...`;
        
        const reportOutput = document.getElementById('report-output');
        if (!reportOutput) {
            console.error("Report output container not found.");
            alert("Error: No se pudo encontrar el contenedor del informe.");
            btn.disabled = false;
            btn.innerHTML = 'Generar Informe';
            return;
        }

        const year = document.getElementById('report-year-filter').value;
        const periodType = document.getElementById('report-type').value;
        const periodIndex = document.getElementById('report-period-select').value;
        const {
            current: currentPeriod,
            previous: previousPeriod,
            label
        } = getDateRanges(parseInt(year), periodType, parseInt(periodIndex));

        const logoBase64 = ''; 

        const isGlobalAdminReport = appState.profile.rol === 'admin' && appState.globalEstablishmentFilter === 'all';

        try {
            const yearStart = new Date(parseInt(year), 0, 1);
            const yearEnd = new Date(parseInt(year), 11, 31);
            const monthlyRanges = getMonthlyRanges(currentPeriod.start, currentPeriod.end);
            
            const fetchDataForReport = (isGlobal) => {
                return Promise.all([
                    getWasteDataForPeriod(currentPeriod.start, currentPeriod.end, isGlobal),
                    getWasteDataForPeriod(previousPeriod.start, previousPeriod.end, isGlobal),
                    getWasteDataForPeriod(yearStart, yearEnd, isGlobal),
                    fetchAllDataFromAllDBs('units', '*'),
                    getInvoiceDataForPeriod(currentPeriod.start, currentPeriod.end, isGlobal),
                    getInvoiceDataForPeriod(previousPeriod.start, previousPeriod.end, isGlobal),
                    ...monthlyRanges.map(range => getWasteDataForPeriod(range.start, range.end, isGlobal))
                ]);
            };
            
            let reportHTML;

            if (isGlobalAdminReport) {
                const [allCurrentWaste, allPreviousWaste, allYearlyWaste, allUnitsData, allInvoicesData, allPreviousInvoicesData, ...allMonthlyWasteData] = await fetchDataForReport(true);
                const monthlyDataPackage = { ranges: monthlyRanges, data: allMonthlyWasteData };
                const analysisData = processAdvancedReportData({
                    currentWaste: allCurrentWaste, previousWaste: allPreviousWaste, yearlyWasteForAnnex: allYearlyWaste, allUnits: allUnitsData,
                    invoices: allInvoicesData, previousInvoices: allPreviousInvoicesData,
                    currentPeriod, previousPeriod, label, logoBase64, monthlyDataPackage, isConsolidated: true
                });
                reportHTML = renderAdvancedReport(analysisData);
            } else {
                const [currentWaste, previousWaste, yearlyWaste, units, invoices, prevInvoices, ...monthlyWaste] = await fetchDataForReport(false);
                const monthlyDataPackage = { ranges: monthlyRanges, data: monthlyWaste };
                const analysisData = processAdvancedReportData({
                    currentWaste, previousWaste, yearlyWasteForAnnex: yearlyWaste, allUnits: units,
                    invoices, previousInvoices: prevInvoices,
                    currentPeriod, previousPeriod, label, logoBase64, monthlyDataPackage, isConsolidated: false
                });
                reportHTML = renderAdvancedReport(analysisData);
            }
            
            reportOutput.innerHTML = reportHTML;
            document.getElementById('report-output-wrapper').classList.remove('hidden');
            document.getElementById('download-pdf-btn').classList.remove('hidden');
            
            setTimeout(() => {
                const analysisDataForCharts = JSON.parse(reportOutput.querySelector('#analysis-data-json').textContent);
                renderReportCharts(analysisDataForCharts);
                document.querySelectorAll('.sortable-table').forEach(makeTableSortable);
            }, 100);
            
            document.getElementById('report-output-wrapper').scrollIntoView({ behavior: 'smooth' });

        } catch (error) {
            console.error("Error al generar el reporte:", error);
            alert("Error al recopilar datos para el informe: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Generar Informe';
        }
    };
    
    const downloadReportAsPDF = async () => {
        const { jsPDF } = window.jspdf;
        const downloadBtn = document.getElementById('download-pdf-btn');
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = `<div class="loader !w-5 !h-5 !border-2 mr-2"></div> Creando PDF...`;

        try {
            const reportPages = document.querySelectorAll('#report-output .report-page');
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
                
                const imgHeight = (canvas.height * pdfWidth) / canvas.width;
                let heightLeft = imgHeight;
                let position = 0;

                if (i > 0) {
                    pdf.addPage();
                }
                pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
                heightLeft -= pdfHeight;

                while (heightLeft >= 0) {
                  position = heightLeft - imgHeight;
                  pdf.addPage();
                  pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
                  heightLeft -= pdfHeight;
                }
            }
            pdf.save('Informe_GestionREAS.pdf');
         } catch (error) {
            console.error("Error generating PDF:", error);
            alert("Error al generar el PDF: " + error.message);
        } finally {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="fas fa-file-pdf mr-2"></i>Descargar PDF';
        }
    };
    
    const processMonthlyAnnexData = (yearlyWasteData) => {
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthlySummary = monthNames.map(name => ({
            month: name,
            special: 0,
            hazardous: 0,
            assimilable: 0,
            radioactive: 0,
            total: 0
        }));

        const allWaste = [
            ...(yearlyWasteData.special || []).map(d => ({ ...d, category: 'special' })),
            ...(yearlyWasteData.hazardous || []).map(d => ({ ...d, category: 'hazardous' })),
            ...(yearlyWasteData.assimilable || []).map(d => ({ ...d, category: 'assimilable' })),
            ...(yearlyWasteData.radioactive || []).map(d => ({ ...d, category: 'radioactive' }))
        ];

        allWaste.forEach(record => {
            const monthIndex = new Date(record.date).getUTCMonth();
            if (monthIndex >= 0 && monthIndex < 12) {
                monthlySummary[monthIndex][record.category] += parseFloat(record.weight_kg || 0);
                monthlySummary[monthIndex].total += parseFloat(record.weight_kg || 0);
            }
        });

        return monthlySummary;
    };
    
    const processConsolidatedBreakdown = (currentWaste) => {
        const breakdown = {};
        const allWaste = [
            ...(currentWaste.special || []),
            ...(currentWaste.hazardous || []),
            ...(currentWaste.assimilable || []),
            ...(currentWaste.radioactive || [])
        ];
        
        allWaste.forEach(r => {
            const est = appState.allEstablishments.find(e => {
                if (r.source === 'hpl') return e.source === 'hpl';
                return e.source === 'sst' && String(e.id) === String(r.units?.establecimiento_id);
            });
            const estName = est ? est.nombre : (r.source === 'hpl' ? 'Hospital Penco Lirquén' : `Desconocido (${r.source})`);

            if (!breakdown[estName]) {
                breakdown[estName] = 0;
            }
            breakdown[estName] += parseFloat(r.weight_kg || 0);
        });
        
        const total = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

        return Object.entries(breakdown)
            .map(([name, kg]) => ({
                name,
                kg,
                percentage: total > 0 ? (kg / total) * 100 : 0
            }))
            .sort((a, b) => b.kg - a.kg);
    };

    const groupWaste = (wasteData) => {
        const result = {
            special: {}, hazardous: {}, assimilable: 0, radioactive: 0,
            byUnit: {
                special: {},
                hazardous: {},
                assimilable: {},
                radioactive: {}
            }
        };

        const processWasteCategory = (data, category) => {
            (data || []).forEach(r => {
                const weight = parseFloat(r.weight_kg || 0);
                const unitName = r.units?.name || 'Unidad Desconocida';
                const establishmentName = r.units?.establecimiento?.nombre || (r.source === 'hpl' ? 'Hospital Penco Lirquén' : 'Est. Desconocido');
                const unitKey = `${establishmentName}__${unitName}`;

                if (category === 'assimilable' || category === 'radioactive') {
                    result[category] += weight;
                    result.byUnit[category][unitKey] = (result.byUnit[category][unitKey] || { establishment: establishmentName, unit: unitName, kg: 0 });
                    result.byUnit[category][unitKey].kg += weight;
                } else { // Special and Hazardous
                    if (!r.waste_type) return;
                    const subcatKey = r.waste_type.trim().toUpperCase();
                    result[category][subcatKey] = (result[category][subcatKey] || 0) + weight;
                    
                    if (!result.byUnit[category][unitKey]) {
                        result.byUnit[category][unitKey] = { establishment: establishmentName, unit: unitName, subcategories: {} };
                    }
                    result.byUnit[category][unitKey].subcategories[subcatKey] = (result.byUnit[category][unitKey].subcategories[subcatKey] || 0) + weight;
                }
            });
        };

        processWasteCategory(wasteData.special, 'special');
        processWasteCategory(wasteData.hazardous, 'hazardous');
        processWasteCategory(wasteData.assimilable, 'assimilable');
        processWasteCategory(wasteData.radioactive, 'radioactive');
        
        return result;
    };


    const processAdvancedReportData = (sourceData) => {
        const {
            currentWaste, previousWaste, yearlyWasteForAnnex, allUnits,
            invoices, previousInvoices, currentPeriod, previousPeriod, label, logoBase64,
            monthlyDataPackage, isConsolidated
        } = sourceData;

        const sumWasteValues = (wasteObj) => {
            const special = Object.values(wasteObj.special || {}).reduce((s, v) => s + v, 0);
            const hazardous = Object.values(wasteObj.hazardous || {}).reduce((s, v) => s + v, 0);
            const assimilable = wasteObj.assimilable || 0;
            const radioactive = wasteObj.radioactive || 0;
            return { special, hazardous, assimilable, radioactive, total: special + hazardous + assimilable + radioactive };
        };

        const currentGroup = groupWaste(currentWaste);
        const previousGroup = groupWaste(previousWaste);

        const periodTotals = sumWasteValues(currentGroup);
        const previousPeriodTotals = sumWasteValues(previousGroup);

        const allSpecialKeys = new Set([
            ...Object.keys(window.APP_CONFIG.wasteTypeOptions.special_waste_categories),
            ...Object.keys(currentGroup.special),
            ...Object.keys(previousGroup.special)
        ]);

        const allHazardousKeys = new Set([
            ...Object.keys(currentGroup.hazardous),
            ...Object.keys(previousGroup.hazardous)
        ]);

        const monthlyAnalysis = monthlyDataPackage.data.map((monthData, index) => {
            const groupedMonth = groupWaste(monthData);
            const monthTotals = sumWasteValues(groupedMonth);
            return {
                label: monthlyDataPackage.ranges[index].label,
                totals: monthTotals
            };
        });

        const generalCategoryAnalysis = ['special', 'hazardous', 'assimilable', 'radioactive'].map(category => {
            const totalPeriod = periodTotals[category];
            const totalPreviousPeriod = previousPeriodTotals[category];
            const periodVariation = window.calcVariation(totalPeriod, totalPreviousPeriod);

            const monthlyVariations = [];
            if (monthlyAnalysis.length > 1) {
                for (let i = 1; i < monthlyAnalysis.length; i++) {
                    const currentMonthTotal = monthlyAnalysis[i].totals[category];
                    const prevMonthTotal = monthlyAnalysis[i - 1].totals[category];
                    monthlyVariations.push({
                        text: `Comparado con ${monthlyAnalysis[i - 1].label}, la generación en ${monthlyAnalysis[i].label}`,
                        variation: window.calcVariation(currentMonthTotal, prevMonthTotal)
                    });
                }
            }
            return { category, totalPeriod, periodVariation, monthlyVariations };
        });

        const costData = { total: 0, byProvider: {} };
        (invoices || []).forEach(inv => {
            const provider = inv.agreement?.razon_social || 'Proveedor Desconocido';
            if (!costData.byProvider[provider]) {
                costData.byProvider[provider] = { special_kg: 0, hazardous_kg: 0, total_cost: 0 };
            }
            costData.byProvider[provider].special_kg += inv.pre_invoice_kg_special || 0;
            costData.byProvider[provider].hazardous_kg += inv.pre_invoice_kg_hazardous || 0;
            costData.byProvider[provider].total_cost += inv.pre_invoice_amount_iva || 0;
        });
        costData.total = Object.values(costData.byProvider).reduce((sum, p) => sum + p.total_cost, 0);

        const sumInvoicedKg = (invList) => (invList || []).reduce((acc, inv) => {
            acc.special += inv.pre_invoice_kg_special || 0;
            acc.hazardous += inv.pre_invoice_kg_hazardous || 0;
            return acc;
        }, { special: 0, hazardous: 0 });

        const currentInvoicedKg = sumInvoicedKg(invoices);
        const previousInvoicedKg = sumInvoicedKg(previousInvoices);

        const invoiceKgAnalysis = {
            special_var: window.calcVariation(currentInvoicedKg.special, previousInvoicedKg.special),
            hazardous_var: window.calcVariation(currentInvoicedKg.hazardous, previousInvoicedKg.hazardous),
            current_special: currentInvoicedKg.special,
            current_hazardous: currentInvoicedKg.hazardous,
        };
        
        const getTopUnits = (unitGroups) => {
            const totals = {}; // key will be "unit__establishment"
            const processGroup = (group) => {
                Object.values(group).forEach(item => {
                    const key = `${item.unit}__${item.establishment}`;
                    const weight = item.kg !== undefined ? item.kg : Object.values(item.subcategories).reduce((s, v) => s + v, 0);
                    totals[key] = (totals[key] || 0) + weight;
                });
            };
            processGroup(unitGroups.special);
            processGroup(unitGroups.hazardous);
            processGroup(unitGroups.radioactive);

            return Object.entries(totals)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([key, _]) => {
                    const [unit, establishment] = key.split('__');
                    return { unit, establishment };
                });
        };
        
        const getTopRsadUnits = (unitGroups) => {
            return Object.values(unitGroups.assimilable || {})
                .sort((a, b) => b.kg - a.kg)
                .slice(0, 3)
                .map(u => ({ unit: u.unit, establishment: u.establishment }));
        };

        const executiveSummaryData = {
            periodLabel: label,
            totalSpecial: periodTotals.special,
            totalHazardous: periodTotals.hazardous,
            totalRadioactive: periodTotals.radioactive,
            totalRsad: periodTotals.assimilable,
            totalSpecialPrevious: previousPeriodTotals.special,
            totalHazardousPrevious: previousPeriodTotals.hazardous,
            totalRadioactivePrevious: previousPeriodTotals.radioactive,
            totalRsadPrevious: previousPeriodTotals.assimilable,
            invoiceCount: invoices.length,
            invoicesTotal: costData.total,
            topReasUnits: getTopUnits(currentGroup.byUnit),
            topRsadUnits: getTopRsadUnits(currentGroup.byUnit),
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
                if(record.waste_type) {
                    const key = record.waste_type.trim().toUpperCase();
                    if (specialSubcategoriesMonthly[key]) {
                        specialSubcategoriesMonthly[key][monthIndex] += parseFloat(record.weight_kg || 0);
                    }
                }
            });
        });

        const rsadByUnitMonthly = {};
        monthlyDataPackage.data.forEach((monthData, monthIndex) => {
            (monthData.assimilable || []).forEach(record => {
                if (record.units?.name) {
                    const estName = record.units.establecimiento?.nombre || (record.source === 'hpl' ? 'Hospital Penco Lirquén' : 'Est. Desconocido');
                    const key = `${estName}__${record.units.name}`;
                    if (!rsadByUnitMonthly[key]) {
                        rsadByUnitMonthly[key] = {
                            establishment: estName,
                            unit: record.units.name,
                            monthlyValues: Array(monthlyDataPackage.data.length).fill(0)
                        };
                    }
                    rsadByUnitMonthly[key].monthlyValues[monthIndex] += parseFloat(record.weight_kg || 0);
                }
            });
        });

        const allSpecialSubcategories = new Set();
        (currentWaste.special || []).forEach(r => { if(r.waste_type) allSpecialSubcategories.add(r.waste_type.trim().toUpperCase()) });
        const allHazardousSubcategories = new Set();
        (currentWaste.hazardous || []).forEach(r => { if(r.waste_type) allHazardousSubcategories.add(r.waste_type.trim().toUpperCase()) });

        const consolidatedBreakdown = processConsolidatedBreakdown(currentWaste);

        const breakdownByCategoryPerEstablishment = {};
        if (isConsolidated) {
            const allWasteForBreakdown = [
                ...(currentWaste.special || []).map(r => ({ ...r, mainCat: 'special' })),
                ...(currentWaste.hazardous || []).map(r => ({ ...r, mainCat: 'hazardous' })),
                ...(currentWaste.assimilable || []).map(r => ({ ...r, mainCat: 'assimilable' })),
                ...(currentWaste.radioactive || []).map(r => ({ ...r, mainCat: 'radioactive' }))
            ];

            allWasteForBreakdown.forEach(r => {
                const est = appState.allEstablishments.find(e => {
                    if (r.source === 'hpl') return e.source === 'hpl';
                    return e.source === 'sst' && r.units && String(e.id) === String(r.units.establecimiento_id);
                });
                const estName = est ? est.nombre : (r.source === 'hpl' ? 'Hospital Penco Lirquén' : `Desconocido (${r.source})`);

                if (!breakdownByCategoryPerEstablishment[estName]) {
                    breakdownByCategoryPerEstablishment[estName] = {
                        totals: { special: 0, hazardous: 0, assimilable: 0, radioactive: 0 },
                        specialSubcategories: {},
                        hazardousSubcategories: {}
                    };
                }

                const weight = parseFloat(r.weight_kg || 0);
                const target = breakdownByCategoryPerEstablishment[estName];
                target.totals[r.mainCat] += weight;

                if (r.mainCat === 'special' && r.waste_type) {
                    const key = r.waste_type.trim().toUpperCase();
                    target.specialSubcategories[key] = (target.specialSubcategories[key] || 0) + weight;
                }
                if (r.mainCat === 'hazardous' && r.waste_type) {
                    const key = r.waste_type.trim().toUpperCase();
                    target.hazardousSubcategories[key] = (target.hazardousSubcategories[key] || 0) + weight;
                }
            });
        }
        
        return {
            isConsolidated,
            periodLabel: label, currentPeriod, periodTotals, previousPeriodTotals, costData, logoBase64,
            invoicesData: invoices.sort((a, b) => new Date(b.billing_cycle_end) - new Date(a.billing_cycle_end)),
            monthlyAnnexData, executiveSummaryData,
            generalCategoryAnalysis,
            invoiceKgAnalysis,
            monthlyAnalysisData: monthlyAnalysis,
            specialByUnitWithSubcategories: currentGroup.byUnit.special,
            hazardousByUnitWithSubcategories: currentGroup.byUnit.hazardous,
            allSpecialSubcategories,
            allHazardousSubcategories,
            consolidatedBreakdown,
            breakdownByCategoryPerEstablishment,
            allSpecialSubcategoriesForReport: ['CORTO-PUNZANTES', 'CULTIVOS Y MUESTRAS ALMACENADAS', 'PATOLOGICOS', 'RESTOS DE ANIMALES', 'SANGRE Y PRODUCTOS DERIVADOS'],
            rsadByUnit: Object.values(currentGroup.byUnit.assimilable || {})
                .filter(d => d.kg > 0)
                .sort((a, b) => b.kg - a.kg),
            specialSubcategories: Array.from(allSpecialKeys).map(cat => {
                const periodKg = currentGroup.special[cat] || 0;
                const previousKg = previousGroup.special[cat] || 0;
                return {
                    category: cat,
                    period: periodKg,
                    previous: previousKg,
                    variation: window.calcVariation(periodKg, previousKg),
                    percentage: periodTotals.special > 0 ? (periodKg / periodTotals.special) * 100 : 0
                };
            }).sort((a, b) => b.period - a.period),
            hazardousSubcategories: Array.from(allHazardousKeys).map(type => {
                const kg = currentGroup.hazardous[type] || 0;
                const previousKg = previousGroup.hazardous[type] || 0;
                return {
                    category: type,
                    period: kg,
                    previous: previousKg,
                    variation: window.calcVariation(kg, previousKg),
                    percentage: periodTotals.hazardous > 0 ? (kg / periodTotals.hazardous) * 100 : 0
                };
            }).filter(item => item.period > 0 || item.previous > 0).sort((a, b) => b.period - a.period),
            specialSubcategoriesMonthly,
            rsadByUnitMonthly
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

        const logoHtml = data.logoBase64 ? `<img crossorigin="anonymous" src="${data.logoBase64}" alt="Logo" style="height: 64px;">` : '';
        const coverLogoHtml = data.logoBase64 ? `<img crossorigin="anonymous" src="${data.logoBase64}" alt="Logo" style="height: 96px; margin: 0 auto;">` : '';

        let encargadoNombre = appState.profile.nombre_completo || appState.user.email;
        let encargadoCargo = appState.profile.rol === 'admin' ? 'Administrador General' : 'Unidad de REAS';
        let establecimientoNombre;
        if(data.isConsolidated) {
            establecimientoNombre = 'Red Asistencial (Consolidado)';
        } else if (appState.profile.rol === 'admin' && appState.globalEstablishmentFilter !== 'all') {
            const [src, estId] = appState.globalEstablishmentFilter.split(/-(.+)/);
            const estObj = appState.allEstablishments.find(e => e.source === src && String(e.id) === String(estId));
            establecimientoNombre = estObj ? estObj.nombre : 'Establecimiento Seleccionado';
        } else {
            establecimientoNombre = appState.establishment?.nombre || 'Establecimiento No Asignado';
        }

        const renderCategoryName = (cat) => {
            if (cat === 'special') return 'Residuos Especiales';
            if (cat === 'hazardous') return 'Residuos Peligrosos';
            if (cat === 'assimilable') return 'Residuos Asimilables a Domiciliario (RSAD)';
            if (cat === 'radioactive') return 'Residuos Radiactivos';
            return cat;
        };
        
        const createVerticalSubcategoryTableHTML = (unitSubcatData, type) => {
            const isAdmin = appState.profile.rol === 'admin';
            let rows = [];
            for (const unitKey in unitSubcatData) {
                const { establishment, unit, subcategories } = unitSubcatData[unitKey];
                for (const subcatName in subcategories) {
                    rows.push({
                        establishment,
                        unit,
                        subcategory: subcatName,
                        kg: subcategories[subcatName]
                    });
                }
            }

            if (rows.length === 0) return `<p>No hay datos de residuos ${type === 'special' ? 'especiales' : 'peligrosos'} para mostrar en este período.</p>`;
            
            rows.sort((a,b) => {
                if (a.establishment !== b.establishment) return a.establishment.localeCompare(b.establishment);
                if (a.unit !== b.unit) return a.unit.localeCompare(b.unit);
                return a.subcategory.localeCompare(b.subcategory);
            });

            const establishmentHeader = isAdmin ? `<th data-sortable="true" style="cursor:pointer;">Establecimiento</th>` : '';
            const establishmentCell = (row) => isAdmin ? `<td>${row.establishment}</td>` : '';
            
            return `<table class="sortable-table" style="margin-top: 1rem;">
                <thead><tr>
                    ${establishmentHeader}
                    <th data-sortable="true" style="cursor:pointer;">Unidad</th>
                    <th data-sortable="true" style="cursor:pointer;">Subcategoría</th>
                    <th data-sortable="true" style="cursor:pointer;" class="text-right">Peso (kg)</th>
                </tr></thead>
                <tbody>
                    ${rows.map(row => `<tr>
                        ${establishmentCell(row)}
                        <td>${row.unit}</td>
                        <td>${row.subcategory}</td>
                        <td class="text-right">${row.kg.toFixed(1)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        };


        const coverPageHTML = `
            <div class="report-page" style="text-align: center; justify-content: space-between; page-break-after: always;">
                <header style="padding-top: 2rem;">${coverLogoHtml}</header>
                <main style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center;">
                    <h1 style="font-size: 2.5rem; font-weight: 700;">Informe de Gestión de la unidad de REAS</h1>
                    <h2 style="font-size: 1.5rem; font-weight: 600; color: #4b5563; margin-top: 1rem;">${establecimientoNombre}</h2>
                    <div style="margin-top: 3rem; max-width: 500px; margin-left: auto; margin-right: auto;">
                        <hr><p style="font-size: 1.25rem; color: #4b5563; text-align: center;"><span style="font-weight: 600;">Período:</span> ${data.periodLabel}</p><hr>
                    </div>
                </main>
                <footer style="padding-bottom: 2rem; font-size: 0.875rem; color: #4b5563;"><p><strong>Elaborado por:</strong> ${encargadoNombre}, ${encargadoCargo}</p><p><strong>Fecha de Emisión:</strong> ${new Date().toLocaleDateString('es-CL')}</p></footer>
            </div>`;

        const summary = data.executiveSummaryData;
        const varTotal = calcVariation(data.periodTotals.total, data.previousPeriodTotals.total);
        const getTrendText = (variation, type) => {
            if (variation === Infinity) return `se registró generación de ${type} por primera vez`;
            if (!isFinite(variation) || Math.abs(variation) < 5) return `se mantuvo relativamente estable en la generación de ${type}`;
            if (variation > 5) return `se observó un aumento significativo en la generación de ${type}`;
            return `se observó una disminución significativa en la generación de ${type}`;
        };
        
        const topReasUnitsText = data.isConsolidated
            ? summary.topReasUnits.map(u => `${u.unit} (${u.establishment})`).join(', ')
            : summary.topReasUnits.map(u => u.unit).join(', ');

        const topRsadUnitsText = data.isConsolidated
            ? summary.topRsadUnits.map(u => `${u.unit} (${u.establishment})`).join(', ')
            : summary.topRsadUnits.map(u => u.unit).join(', ');

        const executiveSummaryHTML = `
            <div class="report-page" style="page-break-after: always;">
                <header class="report-header">${logoHtml}<h1>Resumen Ejecutivo: ${establecimientoNombre}</h1></header>
                <main>
                    <h3>I. Introducción y Alcance</h3>
                    <p>El presente informe de gestión integral analiza la generación y manejo de Residuos en <strong>${establecimientoNombre}</strong> para el período <strong>${summary.periodLabel}</strong>. El objetivo es proporcionar una visión clara del desempeño, identificar tendencias, y fundamentar la toma de decisiones para la optimización de recursos y el cumplimiento normativo.</p>
                    
                    <h3>II. Indicadores Clave de Desempeño (KPIs)</h3>
                    <table style="margin-top: 1rem;">
                        <thead><tr><th>Indicador</th><th class="text-right">Periodo Actual</th><th class="text-right">Periodo Anterior</th><th class="text-right">Variación</th></tr></thead>
                        <tbody>
                            <tr><td>Residuos Peligrosos (kg)</td><td class="text-right">${summary.totalHazardous.toFixed(1)}</td><td class="text-right">${summary.totalHazardousPrevious.toFixed(1)}</td><td class="text-right">${renderVar(calcVariation(summary.totalHazardous, summary.totalHazardousPrevious))}</td></tr>
                            <tr><td>Residuos Especiales (kg)</td><td class="text-right">${summary.totalSpecial.toFixed(1)}</td><td class="text-right">${summary.totalSpecialPrevious.toFixed(1)}</td><td class="text-right">${renderVar(calcVariation(summary.totalSpecial, summary.totalSpecialPrevious))}</td></tr>
                            <tr><td>Residuos Radiactivos (kg)</td><td class="text-right">${summary.totalRadioactive.toFixed(1)}</td><td class="text-right">${summary.totalRadioactivePrevious.toFixed(1)}</td><td class="text-right">${renderVar(calcVariation(summary.totalRadioactive, summary.totalRadioactivePrevious))}</td></tr>
                            <tr><td>Residuos Asimilables (RSAD) (kg)</td><td class="text-right">${summary.totalRsad.toFixed(1)}</td><td class="text-right">${summary.totalRsadPrevious.toFixed(1)}</td><td class="text-right">${renderVar(calcVariation(summary.totalRsad, summary.totalRsadPrevious))}</td></tr>
                            <tr style="font-weight: bold; background-color: #f3f4f6;"><td>Generación General (kg)</td><td class="text-right">${data.periodTotals.total.toFixed(1)}</td><td class="text-right">${data.previousPeriodTotals.total.toFixed(1)}</td><td class="text-right">${renderVar(varTotal)}</td></tr>
                            <tr><td>Costo Total Facturado (OCs)</td><td class="text-right">${formatCLP(summary.invoicesTotal)}</td><td colspan="2" style="text-align: center; color: #6b7280;">N/A</td></tr>
                        </tbody>
                    </table>

                    <h3>III. Principales Hallazgos</h3>
                    <ul style="list-style-type: disc; padding-left: 20px;">
                        <li>En el período, ${getTrendText(varTotal, 'residuos en general')}, con un total de <strong>${data.periodTotals.total.toFixed(1)} kg</strong>.</li>
                        <li>Las unidades que más contribuyeron a la generación de Residuos Peligrosos, Especiales y Radiactivos fueron: <strong>${topReasUnitsText || 'N/A'}</strong>.</li>
                        <li>Para Residuos Asimilables (RSAD), las principales unidades generadoras fueron: <strong>${topRsadUnitsText || 'N/A'}</strong>.</li>
                        <li>El costo total asociado al retiro de residuos, validado a través de <strong>${summary.invoiceCount} Órdenes de Compra</strong>, ascendió a <strong>${formatCLP(summary.invoicesTotal)}</strong>.</li>
                    </ul>

                    <h3>IV. Conclusión General</h3>
                    <p>El período muestra una dinámica de generación de residuos que requiere monitoreo continuo. Las variaciones observadas son indicadores clave para enfocar los esfuerzos de capacitación y optimización. Se debe prestar especial atención a las unidades con mayor generación y a las subcategorías con cambios abruptos para asegurar una segregación correcta y un manejo eficiente de los recursos.</p>
                </main>
            </div>`;

        let sectionCounter = { value: 5 };
        const renderSectionTitle = (title) => `<h3 style="page-break-before: auto;">${(sectionCounter.value++)}. ${title}</h3>`;

        const consolidatedBreakdownHTML = data.isConsolidated ? `
            <div class="report-page" style="page-break-after: always;">
                <header class="report-header">${logoHtml}<h1>Desglose Consolidado por Establecimiento</h1></header>
                <main>
                    ${renderSectionTitle('Generación Total por Establecimiento en la Red')}
                    <p>La siguiente tabla desglosa la generación total de residuos (Peligrosos, Especiales, Asimilables y Radiactivos) para cada establecimiento de la red durante el período <strong>${data.periodLabel}</strong>, mostrando la contribución de cada uno al total consolidado.</p>
                    <table class="sortable-table" style="margin-top: 1rem;">
                        <thead>
                            <tr>
                                <th data-sortable="true" style="cursor:pointer;">Establecimiento</th>
                                <th data-sortable="true" style="cursor:pointer;" class="text-right">Generación Total (kg)</th>
                                <th data-sortable="true" style="cursor:pointer;" class="text-right">% del Total de la Red</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.consolidatedBreakdown.map(item => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td class="text-right">${item.kg.toFixed(1)}</td>
                                    <td class="text-right">${item.percentage.toFixed(2)}%</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr style="font-weight: bold; background-color: #f3f4f6;">
                                <td>Total Red Asistencial</td>
                                <td class="text-right">${data.periodTotals.total.toFixed(1)}</td>
                                <td class="text-right">100.00%</td>
                            </tr>
                        </tfoot>
                    </table>
                    <div class="chart-container" style="height: 400px; margin-top: 2rem;">
                        <canvas id="report-consolidated-breakdown-chart"></canvas>
                    </div>
                </main>
            </div>` : '';
        
        const establishmentBreakdownPagesHTML = data.isConsolidated ? Object.entries(data.breakdownByCategoryPerEstablishment).sort((a,b) => a[0].localeCompare(b[0])).map(([estName, estData]) => {
            const totalKg = Object.values(estData.totals).reduce((s,v) => s+v, 0);
            const specialSubcatRows = Object.entries(estData.specialSubcategories).sort((a,b)=>b[1]-a[1]).map(([name, kg]) => `<tr><td>${name}</td><td class="text-right">${kg.toFixed(1)} kg</td></tr>`).join('');
            const hazardousSubcatRows = Object.entries(estData.hazardousSubcategories).sort((a,b)=>b[1]-a[1]).map(([name, kg]) => `<tr><td>${name}</td><td class="text-right">${kg.toFixed(1)} kg</td></tr>`).join('');
    
            return `
            <div class="report-page" style="page-break-after: always;">
                <header class="report-header">${logoHtml}<h1>Análisis Detallado: ${estName}</h1></header>
                <main>
                    ${renderSectionTitle(`Desglose por Categoría Principal (${estName})`)}
                    <table style="margin-top: 1rem;">
                        <thead><tr><th>Categoría</th><th class="text-right">Total (kg)</th><th class="text-right">${totalKg > 0 ? '% del Total del Establecimiento' : ''}</th></tr></thead>
                        <tbody>
                            <tr><td>Residuos Especiales</td><td class="text-right">${estData.totals.special.toFixed(1)}</td><td class="text-right">${totalKg > 0 ? ((estData.totals.special / totalKg) * 100).toFixed(1) + '%' : '0.0%'}</td></tr>
                            <tr><td>Residuos Peligrosos</td><td class="text-right">${estData.totals.hazardous.toFixed(1)}</td><td class="text-right">${totalKg > 0 ? ((estData.totals.hazardous / totalKg) * 100).toFixed(1) + '%' : '0.0%'}</td></tr>
                            <tr><td>Residuos Asimilables</td><td class="text-right">${estData.totals.assimilable.toFixed(1)}</td><td class="text-right">${totalKg > 0 ? ((estData.totals.assimilable / totalKg) * 100).toFixed(1) + '%' : '0.0%'}</td></tr>
                            <tr><td>Residuos Radiactivos</td><td class="text-right">${estData.totals.radioactive.toFixed(1)}</td><td class="text-right">${totalKg > 0 ? ((estData.totals.radioactive / totalKg) * 100).toFixed(1) + '%' : '0.0%'}</td></tr>
                        </tbody>
                        <tfoot>
                            <tr style="font-weight: bold; background-color: #f3f4f6;">
                                <td>Total</td><td class="text-right">${totalKg.toFixed(1)}</td><td class="text-right">${totalKg > 0 ? '100.0%' : '0.0%'}</td>
                            </tr>
                        </tfoot>
                    </table>
    
                    <div style="display: flex; gap: 2rem; margin-top: 2rem; page-break-inside: avoid;">
                        <div style="flex: 1;">
                            <h4>Subcategorías de R. Especiales</h4>
                            <table>
                               <thead><tr><th>Subcategoría</th><th class="text-right">Total (kg)</th></tr></thead>
                               <tbody>${specialSubcatRows || `<tr><td colspan="2" class="text-center">N/A</td></tr>`}</tbody>
                            </table>
                        </div>
                        <div style="flex: 1;">
                           <h4>Subcategorías de R. Peligrosos</h4>
                            <table>
                               <thead><tr><th>Subcategoría</th><th class="text-right">Total (kg)</th></tr></thead>
                               <tbody>${hazardousSubcatRows || `<tr><td colspan="2" class="text-center">N/A</td></tr>`}</tbody>
                            </table>
                        </div>
                    </div>
                </main>
            </div>`;
        }).join('') : '';

        const generalAnalysisHTML = `
            <div class="report-page" style="page-break-after: always;">
                <header class="report-header">${logoHtml}<h1>Análisis General de Categorías</h1></header>
                <main>
                    ${renderSectionTitle('Análisis General de Categorías')}
                    ${data.generalCategoryAnalysis.map(analysis => `
                        <div style="margin-bottom: 2rem; page-break-inside: avoid;">
                            <h4>${renderCategoryName(analysis.category)}</h4>
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
                    ${renderSectionTitle(`Distribución General de Residuos (${data.periodLabel})`)}
                    <p class="text-xs" style="color: #6b7280;">Este gráfico muestra la proporción de cada categoría principal sobre el total de residuos generados durante el período.</p>
                    <div class="chart-container" style="height: 500px; margin-top: 2rem;"><canvas id="report-main-composition-chart"></canvas></div>
                </main>
            </div>`;
        
        const createPaginatedSubcategoryPages = (unitSubcatData, type, sectionTitle, logoHtml) => {
            let html = '';
            const groupedByEstablishment = Object.values(unitSubcatData).reduce((acc, { establishment, unit, subcategories }) => {
                if (!acc[establishment]) acc[establishment] = [];
                acc[establishment].push({ unit, subcategories });
                return acc;
            }, {});

            if (Object.keys(groupedByEstablishment).length === 0) {
                 return `<div class="report-page" style="page-break-after: always;"><header class="report-header">${logoHtml}<h1>${sectionTitle}</h1></header><main><p>No hay datos de residuos ${type === 'special' ? 'especiales' : 'peligrosos'} para mostrar en este período.</p></main></div>`;
            }

            Object.entries(groupedByEstablishment).sort((a,b) => a[0].localeCompare(b[0])).forEach(([establishment, units]) => {
                const rows = [];
                units.forEach(({ unit, subcategories }) => {
                    for (const subcatName in subcategories) {
                        rows.push({ unit, subcategory: subcatName, kg: subcategories[subcatName] });
                    }
                });
                rows.sort((a,b) => {
                    if (a.unit !== b.unit) return a.unit.localeCompare(b.unit);
                    return a.subcategory.localeCompare(b.subcategory);
                });
                
                const tableRowsHTML = rows.map(row => `<tr><td>${row.unit}</td><td>${row.subcategory}</td><td class="text-right">${row.kg.toFixed(1)}</td></tr>`).join('');

                html += `
                    <div class="report-page" style="page-break-after: always;">
                        <header class="report-header">${logoHtml}<h1>${sectionTitle}</h1></header>
                        <main>
                            ${renderSectionTitle(`Desglose para: ${establishment}`)}
                            <table class="sortable-table" style="margin-top: 1rem;">
                                <thead><tr>
                                    <th data-sortable="true" style="cursor:pointer;">Unidad</th>
                                    <th data-sortable="true" style="cursor:pointer;">Subcategoría</th>
                                    <th data-sortable="true" style="cursor:pointer;" class="text-right">Peso (kg)</th>
                                </tr></thead>
                                <tbody>${tableRowsHTML}</tbody>
                            </table>
                        </main>
                    </div>`;
            });
            return html;
        };

        const createPaginatedRsadPages = (rsadData, monthlyAnalysisData, sectionTitle, logoHtml) => {
            let html = '';
            const groupedByEstablishment = Object.values(rsadData).reduce((acc, { establishment, unit, monthlyValues }) => {
                if (!acc[establishment]) acc[establishment] = [];
                acc[establishment].push({ unit, monthlyValues });
                return acc;
            }, {});

            if (Object.keys(groupedByEstablishment).length === 0) {
                return `<div class="report-page" style="page-break-after: always;"><header class="report-header">${logoHtml}<h1>${sectionTitle}</h1></header><main><p>No hay datos de RSAD para mostrar en este período.</p></main></div>`;
            }

            Object.entries(groupedByEstablishment).sort((a,b) => a[0].localeCompare(b[0])).forEach(([establishment, units]) => {
                const tableRowsHTML = units
                    .filter(u => u.monthlyValues.reduce((s, v) => s + v, 0) > 0)
                    .sort((a, b) => b.monthlyValues.reduce((s,v)=>s+v,0) - a.monthlyValues.reduce((s,v)=>s+v,0))
                    .map(({ unit, monthlyValues }) => `
                        <tr>
                            <td>${unit}</td>
                            ${monthlyValues.map((kg) => `<td class="text-right">${(kg || 0).toFixed(1)}</td>`).join('')}
                        </tr>
                    `).join('');

                html += `
                    <div class="report-page" style="page-break-after: always;">
                        <header class="report-header">${logoHtml}<h1>${sectionTitle}</h1></header>
                        <main>
                            ${renderSectionTitle(`Desglose para: ${establishment}`)}
                            <table class="sortable-table" style="margin-top: 1rem;">
                                <thead><tr>
                                    <th data-sortable="true" style="cursor:pointer; text-align: left;">Unidad de Servicio</th>
                                    ${monthlyAnalysisData.map(m => `<th class="text-right">${m.label}</th>`).join('')}
                                </tr></thead>
                                <tbody>${tableRowsHTML}</tbody>
                            </table>
                        </main>
                    </div>`;
            });
            return html;
        };
        
        const createDetailedSubcategoryTableHTML = (subcategoryData, totalPeriodKg, categoryLabel) => {
            if (!subcategoryData || subcategoryData.length === 0) return `<p>No se registraron residuos de tipo ${categoryLabel} en este período.</p>`;
            
            const rowsHTML = subcategoryData.map(subcat => `
                <tr>
                    <td>${subcat.category}</td>
                    <td class="text-right">${subcat.period.toFixed(1)} kg</td>
                    <td class="text-right">${subcat.percentage.toFixed(1)}%</td>
                    <td class="text-right">${renderVar(subcat.variation)}</td>
                </tr>
            `).join('');

            return `<table style="margin-top: 1rem;">
                <thead>
                    <tr>
                        <th>Subcategoría</th>
                        <th class="text-right">Total Período (kg)</th>
                        <th class="text-right">% del Total de ${categoryLabel}</th>
                        <th class="text-right">Variación vs Período Ant.</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
                <tfoot>
                    <tr style="font-weight: bold; background-color: #f3f4f6;">
                        <td>Total</td>
                        <td class="text-right">${totalPeriodKg.toFixed(1)} kg</td>
                        <td class="text-right">100.0%</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>`;
        };
        
        const specialAnalysisHTML = data.isConsolidated
            ? createPaginatedSubcategoryPages(data.specialByUnitWithSubcategories, 'special', 'Análisis Detallado: Residuos Especiales', logoHtml)
            : `<div class="report-page" style="page-break-after: always;">
                   <header class="report-header">${logoHtml}<h1>Análisis Detallado: Residuos Especiales</h1></header>
                   <main>
                       ${renderSectionTitle('Análisis de Subcategorías')}
                       ${createDetailedSubcategoryTableHTML(data.specialSubcategories, data.periodTotals.special, 'Especiales')}
                       <div class="chart-container" style="height: 300px; margin-top:2rem;">
                           <canvas id="report-special-subcategory-chart"></canvas>
                       </div>
                       <h4 style="margin-top: 2rem;">Evolución Mensual de Subcategorías</h4>
                       <div class="chart-container" style="height: 300px; margin-top:1rem;">
                           <canvas id="report-special-monthly-trend-chart"></canvas>
                       </div>
                   </main>
               </div>`;

        const hazardousAnalysisHTML = data.isConsolidated
            ? createPaginatedSubcategoryPages(data.hazardousByUnitWithSubcategories, 'hazardous', 'Análisis Detallado: Residuos Peligrosos', logoHtml)
            : `<div class="report-page" style="page-break-after: always;">
                   <header class="report-header">${logoHtml}<h1>Análisis Detallado: Residuos Peligrosos</h1></header>
                   <main>
                       ${renderSectionTitle('Análisis de Subcategorías')}
                       ${createDetailedSubcategoryTableHTML(data.hazardousSubcategories, data.periodTotals.hazardous, 'Peligrosos')}
                       <div class="chart-container" style="height: 300px; margin-top:2rem;">
                           <canvas id="report-hazardous-subcategory-chart"></canvas>
                       </div>
                   </main>
               </div>`;

        const createSingleEstablishmentRsadTable = () => {
             const isAdmin = appState.profile.rol === 'admin';
             const establishmentHeader = isAdmin ? `<th data-sortable="true" style="cursor:pointer;">Establecimiento</th>` : '';
             const establishmentCell = (item) => isAdmin ? `<td>${item.establishment}</td>` : '';
             const tableRows = Object.values(data.rsadByUnitMonthly)
                .filter(item => item.monthlyValues.reduce((s, v) => s + v, 0) > 0)
                .sort((a, b) => b.monthlyValues.reduce((s,v)=>s+v,0) - a.monthlyValues.reduce((s,v)=>s+v,0))
                .map(item => `
                    <tr>
                        ${establishmentCell(item)}
                        <td>${item.unit}</td>
                        ${item.monthlyValues.map(kg => `<td class="text-right">${(kg || 0).toFixed(1)}</td>`).join('')}
                    </tr>
                `).join('');

            return `<table class="sortable-table" style="margin-top: 1rem;">
                <thead><tr>
                    ${establishmentHeader}
                    <th data-sortable="true" style="cursor:pointer; text-align: left;">Unidad de Servicio</th>
                    ${data.monthlyAnalysisData.map(m => `<th class="text-right">${m.label}</th>`).join('')}
                </tr></thead>
                <tbody>${tableRows}</tbody>
            </table>`;
        }
        
        const rsadAnalysisHTML = data.isConsolidated
            ? createPaginatedRsadPages(data.rsadByUnitMonthly, data.monthlyAnalysisData, 'Análisis Detallado: RSAD', logoHtml)
            : `<div class="report-page" style="page-break-after: always;">
                   <header class="report-header">${logoHtml}<h1>Análisis Detallado: RSAD</h1></header>
                   <main>
                       ${renderSectionTitle('Análisis de Residuos Asimilables a Domiciliario')}
                       <p>La generación de RSAD en el período fue de <strong>${data.periodTotals.assimilable.toFixed(1)} kg</strong>. El siguiente gráfico muestra las principales unidades generadoras.</p>
                       <div class="chart-container" style="height: 300px; margin-top:2rem;">
                           <canvas id="report-rsad-by-unit-chart"></canvas>
                       </div>
                       <h4 style="margin-top: 2rem;">Generación Mensual de RSAD por Unidad de Servicio (kg)</h4>
                       ${createSingleEstablishmentRsadTable()}
                   </main>
               </div>`;

        const radioactiveAnalysisHTML = `
             <div class="report-page" style="page-break-after: always;">
                <header class="report-header">${logoHtml}<h1>Análisis Detallado: Residuos Radiactivos</h1></header>
                <main>
                    ${renderSectionTitle('Residuos Radiactivos Generados en el Período')}
                    <p>Se generó un total de <strong>${data.periodTotals.radioactive.toFixed(1)} kg</strong> de residuos radiactivos de baja intensidad.</p>
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
                            ${renderSectionTitle('Órdenes de Compra (OC) Registradas en Período')}
                            ${financialAnalysisText()}
                            <p class="text-xs mt-2" style="color: #6b7280;">A continuación, se detallan las OCs cuyos ciclos de facturación corresponden a los meses del período analizado.</p>
                            <table style="margin-top: 1rem;">
                                <thead><tr><th>N° OC</th><th>Proveedor</th><th>Periodo Facturado</th><th class="text-right">Monto (IVA Incl.)</th><th>Estado</th></tr></thead>
                                <tbody>
                                    ${(data.invoicesData && data.invoicesData.length > 0) ? data.invoicesData.map(inv => {
                                        const endDate = new Date(inv.billing_cycle_end + 'T00:00:00');
                                        const periodLabel = `${monthNamesFull[endDate.getUTCMonth()]} ${endDate.getUTCFullYear()}`;
                                        return `<tr><td>${inv.purchase_order_number}</td><td>${inv.agreement?.razon_social || 'N/A'}</td><td>${periodLabel}</td><td class="text-right">${formatCLP(inv.pre_invoice_amount_iva)}</td><td>${inv.status}</td></tr>`;
                                    }).join('') : `<tr><td colspan="5" style="text-align: center;">No hay OCs para este período.</td></tr>`}
                                </tbody>
                                <tfoot><tr style="font-weight: bold; background-color: #f3f4f6;"><td colspan="3">Total Facturado en OCs</td><td class="text-right">${formatCLP(data.executiveSummaryData.invoicesTotal)}</td><td></td></tr></tfoot>
                            </table>
                        </section>
                    </main>
                </div>
                <footer style="text-align: right; padding-top: 4rem;">
                    <div style="display: inline-block; text-align: center; border-top: 1px solid #374151; padding-top: 8px; width: 250px;">
                        <p style="font-size: 0.8rem; color: #374151; line-height: 1.2;">${encargadoNombre}</p>
                        <p style="font-size: 0.7rem; color: #6b7280; line-height: 1.2;">${encargadoCargo}</p>
                        <p style="font-size: 0.7rem; color: #6b7280; line-height: 1.2;">${establecimientoNombre}</p>
                    </div>
                </footer>
            </div>`;
            
        const annexAPageHTML = `
            <div class="report-page" style="page-break-after: always;">
                <header class="report-header">${logoHtml}<h1>Anexo A</h1></header>
                <main>
                    <section>
                        <h3>Anexo A: Generación Mensual de Residuos (Año Completo)</h3>
                        <table class="sortable-table" style="margin-top: 1rem;">
                            <thead><tr><th data-sortable="true" style="cursor:pointer;">Mes</th><th data-sortable="true" style="cursor:pointer;" class="text-right">Peligrosos (kg)</th><th data-sortable="true" style="cursor:pointer;" class="text-right">Especiales (kg)</th><th data-sortable="true" style="cursor:pointer;" class="text-right">Asimilables (kg)</th><th data-sortable="true" style="cursor:pointer;" class="text-right">Radiactivos (kg)</th><th data-sortable="true" style="cursor:pointer;" class="text-right">Total (kg)</th></tr></thead>
                            <tbody>${data.monthlyAnnexData.map(m => `<tr><td>${m.month}</td><td class="text-right">${m.hazardous.toFixed(1)}</td><td class="text-right">${m.special.toFixed(1)}</td><td class="text-right">${m.assimilable.toFixed(1)}</td><td class="text-right">${m.radioactive.toFixed(1)}</td><td class="text-right" style="font-weight: bold;">${m.total.toFixed(1)}</td></tr>`).join('')}</tbody>
                            <tfoot>
                                <tr style="font-weight: bold; background-color: #f3f4f6;">
                                    <td>Total Anual</td>
                                    <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + m.hazardous, 0).toFixed(1)}</td>
                                    <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + m.special, 0).toFixed(1)}</td>
                                    <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + m.assimilable, 0).toFixed(1)}</td>
                                    <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + m.radioactive, 0).toFixed(1)}</td>
                                    <td class="text-right">${data.monthlyAnnexData.reduce((s, m) => s + m.total, 0).toFixed(1)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </section>
                </main>
            </div>`;
            
        const annexBPageHTML = `
            <div class="report-page">
                <header class="report-header">${logoHtml}<h1>Anexo B</h1></header>
                <main>
                    <section>
                        <h3>Anexo B: Detalle de Órdenes de Compra</h3>
                        <p class="text-xs" style="color: #6b7280;">Se detallan las OCs cuyos ciclos de facturación corresponden a los meses del período analizado.</p>
                        <table class="sortable-table" style="margin-top: 1rem;">
                            <thead>
                                <tr>
                                    <th data-sortable="true" style="cursor:pointer;">N° Orden de Compra</th>
                                    <th data-sortable="true" style="cursor:pointer;">Convenio</th>
                                    <th data-sortable="true" style="cursor:pointer;">Inicio Ciclo</th>
                                    <th data-sortable="true" style="cursor:pointer;">Fin Ciclo</th>
                                    <th data-sortable="true" style="cursor:pointer;" class="text-right">Kg Especial Prefactura</th>
                                    <th data-sortable="true" style="cursor:pointer;" class="text-right">Kg Peligroso Prefactura</th>
                                    <th data-sortable="true" style="cursor:pointer;" class="text-right">Valor Prefactura (IVA incl.)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(data.invoicesData && data.invoicesData.length > 0) ? data.invoicesData.map(inv => `
                                    <tr>
                                        <td>${inv.purchase_order_number}</td>
                                        <td>${inv.agreement?.razon_social || 'N/A'}</td>
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

        const reportStyles = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                .report-page {
                    font-family: 'Inter', sans-serif; background: white; width: 21.59cm; min-height: 27.94cm; padding: 1.2cm; margin: 1rem auto;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1); box-sizing: border-box; display: flex; flex-direction: column;
                }
                .report-header { display: flex; align-items: center; border-bottom: 2px solid #d1d5db; padding-bottom: 1rem; margin-bottom: 1.5rem; }
                .report-header h1 { font-size: 1.5rem; font-weight: 700; color: #1f2937; margin-left: 1.5rem; }
                h3 { font-size: 1.2rem; font-weight: 700; color: #111827; margin-top: 1.5rem; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #eef2ff; }
                h4 { font-size: 1rem; font-weight: 600; color: #374151; margin-top: 1.25rem; margin-bottom: 0.75rem; }
                p, li { font-size: 0.8rem; text-align: justify; color: #374151; line-height: 1.6; margin-bottom: 0.5rem; }
                ul { margin-bottom: 1rem; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; page-break-inside: avoid; font-size: 0.7rem; }
                th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; }
                th { background-color: #f3f4f6; font-weight: 600; }
                td.text-right, th.text-right { text-align: right; }
                .chart-container { padding: 0.5rem; border: 1px solid #e5e7eb; border-radius: 0.375rem; margin-top: 1rem; margin-bottom: 1rem; page-break-inside: avoid; }
            </style>`;

        const jsonDataScript = `<script id="analysis-data-json" type="application/json">${JSON.stringify(data)}</script>`;

        return reportStyles + jsonDataScript + coverPageHTML + executiveSummaryHTML +
            consolidatedBreakdownHTML + establishmentBreakdownPagesHTML + generalAnalysisHTML + mainPieChartHTML +
            specialAnalysisHTML +
            hazardousAnalysisHTML +
            rsadAnalysisHTML +
            radioactiveAnalysisHTML +
            financialPageHTML + annexAPageHTML + annexBPageHTML;
    };

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
        
        if (data.isConsolidated && document.getElementById('report-consolidated-breakdown-chart')) {
            new Chart(document.getElementById('report-consolidated-breakdown-chart').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: data.consolidatedBreakdown.map(d => d.name),
                    datasets: [{
                        label: 'Generación Total (kg)',
                        data: data.consolidatedBreakdown.map(d => d.kg),
                        backgroundColor: ['#4f46e5', '#818cf8', '#f59e0b', '#fbbf24', '#10b981', '#6ee7b7', '#ef4444', '#f87171']
                    }]
                },
                options: { ...chartDefaultOptions('Generación por Establecimiento'), plugins: { legend: { display: false } } }
            });
        }

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
                        title: { display: false },
                        datalabels: { display: false },
                        legend: {
                            position: 'bottom',
                            labels: {
                                font: { size: 10 },
                                generateLabels: function (chart) {
                                    const data = chart.data;
                                    if (data.labels.length && data.datasets.length) {
                                        const total = chart.getDatasetMeta(0).total || 1;
                                        return data.labels.map((label, i) => {
                                            const value = data.datasets[0].data[i];
                                            const percentage = ((value / total) * 100).toFixed(1) + '%';
                                            return {
                                                text: `${label}: ${percentage}`,
                                                fillStyle: data.datasets[0].backgroundColor[i],
                                                strokeStyle: data.datasets[0].backgroundColor[i],
                                                hidden: isNaN(data.datasets[0].data[i]) || chart.getDatasetMeta(0).data[i].hidden,
                                                pointStyle: 'rect',
                                                lineWidth: 1
                                            };
                                        });
                                    }
                                    return [];
                                }
                            }
                        },
                    }
                }
            });
        }

        const pieChartOptions = {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: false },
                legend: { position: 'right', labels: { font: { size: 9 }, boxWidth: 15 } }
            }
        };

        if (!data.isConsolidated && document.getElementById('report-special-subcategory-chart')) {
             const specialChartCtx = document.getElementById('report-special-subcategory-chart').getContext('2d');
             const specialData = data.specialSubcategories.filter(s => s.period > 0);
             if (specialData.length > 0) {
                 new Chart(specialChartCtx, {
                     type: 'pie',
                     data: {
                         labels: specialData.map(s => s.category),
                         datasets: [{
                             data: specialData.map(s => s.period),
                             backgroundColor: ['#f59e0b', '#fbbf24', '#fcd34d', '#fef3c7', '#fffbeb']
                         }]
                     },
                     options: { ...pieChartOptions, ...chartDefaultOptions('Composición Residuos Especiales (kg)')}
                 });
             }
        }
        
        if (!data.isConsolidated && document.getElementById('report-hazardous-subcategory-chart')) {
             const hazardousChartCtx = document.getElementById('report-hazardous-subcategory-chart').getContext('2d');
             const hazardousData = data.hazardousSubcategories.filter(s => s.period > 0);
             if (hazardousData.length > 0) {
                 new Chart(hazardousChartCtx, {
                     type: 'pie',
                     data: {
                         labels: hazardousData.map(s => s.category),
                         datasets: [{
                             data: hazardousData.map(s => s.period),
                             backgroundColor: ['#ef4444', '#f87171', '#fca5a5', '#fecaca', '#fee2e2']
                         }]
                     },
                     options: { ...pieChartOptions, ...chartDefaultOptions('Composición Residuos Peligrosos (kg)')}
                 });
             }
        }

        if (!data.isConsolidated && document.getElementById('report-rsad-by-unit-chart')) {
             const rsadByUnitCtx = document.getElementById('report-rsad-by-unit-chart').getContext('2d');
             const topRsadUnits = data.rsadByUnit.slice(0, 10).reverse(); // reverse for horizontal bar
             if (topRsadUnits.length > 0) {
                 new Chart(rsadByUnitCtx, {
                     type: 'bar',
                     data: {
                         labels: topRsadUnits.map(u => u.unit),
                         datasets: [{
                             label: 'Total RSAD (kg)',
                             data: topRsadUnits.map(u => u.kg),
                             backgroundColor: '#34d399',
                             borderColor: '#059669',
                             borderWidth: 1
                         }]
                     },
                     options: {
                         ...chartDefaultOptions('Top 10 Unidades Generadoras de RSAD'),
                         indexAxis: 'y', // Horizontal bar chart
                         plugins: { legend: { display: false } }
                     }
                 });
             }
        }

        if (!data.isConsolidated && document.getElementById('report-special-monthly-trend-chart')) {
            const specialTrendCtx = document.getElementById('report-special-monthly-trend-chart').getContext('2d');
            const subcatData = data.specialSubcategoriesMonthly;
            const subcatNames = Object.keys(subcatData);
            const colors = ['#f59e0b', '#fbbf24', '#fcd34d', '#fef3c7', '#fffbeb'].reverse();

            if(subcatNames.length > 0 && data.monthlyAnalysisData.length > 0) {
                new Chart(specialTrendCtx, {
                    type: 'bar',
                    data: {
                        labels: data.monthlyAnalysisData.map(m => m.label),
                        datasets: subcatNames.map((catName, index) => ({
                            label: catName,
                            data: subcatData[catName],
                            backgroundColor: colors[index % colors.length]
                        }))
                    },
                    options: {
                        ...chartDefaultOptions('Evolución Mensual de Subcategorías de R. Especiales (kg)'),
                        scales: {
                            x: { stacked: true },
                            y: { stacked: true, beginAtZero: true }
                        }
                    }
                });
            }
        }
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
    
    const fetchAllDataFromAllDBs = async (tableName, select) => {
		const promises = Object.entries(supabaseClients).map(async ([source, { client, name }]) => {
			if (tableName === 'radioactive_waste' && source === 'hpl') return [];
			try {
                let finalSelect = select;
                if(select === '*' && source === 'hpl' && tableName === 'units'){
                } else if (select === '*' && source === 'hpl'){
                    finalSelect = `*`;
                }

				const { data, error } = await client.from(tableName).select(finalSelect);
				if (error && error.code !== '42P01') console.error(`Error loading ${tableName} from ${name}:`, error);
				return (data || []).map(item => ({ ...item, source, hospitalName: name }));
			} catch (e) {
				console.error(`Critical error loading ${tableName} from ${name}:`, e);
				return [];
			}
		});
		return (await Promise.all(promises)).flat();
	};

	const getInvoiceDataForPeriod = async (startDate, endDate, fetchAllDbs) => {
		const format = (d) => d.toISOString().split('T')[0];
		const s = format(new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1)));
        const e = format(new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 0)));


		const selectString = (source) => source === 'hpl' ? '*, agreement:waste_removal_agreements(*)' : '*, agreement:waste_removal_agreements(*, establecimiento:establecimientos(id, nombre))';

		if (fetchAllDbs) {
			const promises = Object.entries(supabaseClients).map(([source, { client }]) =>
				fetchAll(client.from('monthly_invoices').select(selectString(source)).gte('billing_cycle_end', s).lte('billing_cycle_end', e))
				.then(data => data.map(item => ({ ...item, source })))
			);
			return (await Promise.all(promises)).flat();
		} else {
            const est = appState.establishment;
            if(!est) return [];
            const client = getSupabaseClient(est.source);
            let query = client.from('monthly_invoices').select(selectString(est.source)).gte('billing_cycle_end', s).lte('billing_cycle_end', e);
            
            if(est.source === 'sst'){
                query = query.eq('agreement.establecimiento_id', est.id);
            }
            return await fetchAll(query);
		}
	};
    
    const getWasteDataForPeriod = async (startDate, endDate, fetchAllDbs = false) => {
		const format = (d) => d.toISOString().split('T')[0];
		const s = format(startDate);
		const e = format(endDate);
		
		const allResults = { hazardous: [], special: [], assimilable: [], radioactive: [] };
		
		let clientsToQuery = [];
        const establishmentValue = fetchAllDbs ? 'all' : (appState.profile.rol === 'admin' ? appState.globalEstablishmentFilter : `${appState.establishment.source}-${appState.establishment.id}`);

		if (establishmentValue === 'all') {
			clientsToQuery = Object.entries(supabaseClients).map(([source, {client}]) => ({client, source, establishmentId: null}));
		} else {
			const [source, establishmentId] = establishmentValue.split(/-(.+)/);
			clientsToQuery = [{client: getSupabaseClient(source), source, establishmentId}];
		}
		
		for (const { client, source, establishmentId } of clientsToQuery) {
			const tables = ['hazardous_waste', 'special_waste', 'assimilable_waste'];
			if (source === 'sst') tables.push('radioactive_waste');

			for (const tbl of tables) {
				try {
                    const selectString = source === 'sst'
                        ? `*, units(*, establecimiento:establecimientos(*))`
                        : `*, units(*)`;
					
					let query = client.from(tbl).select(selectString).gte('date', s).lte('date', e);
					
					if (establishmentId && source === 'sst') {
						query = query.eq('units.establecimiento_id', establishmentId);
					}
					
					const data = await fetchAll(query); 
					if (data) {
						const key = tbl.replace('_waste', '');
						allResults[key].push(...data.map(r => ({ ...r, source })));
					}
				} catch (error) {
					console.error(`Error fetching ${tbl} from ${source} for dashboard:`, error.message);
				}
			}
		}
		return allResults;
	};


    const updatePeriodSelector = () => {
        const year = document.getElementById('report-year-filter').value;
        const type = document.getElementById('report-type').value;
        const periodSelect = document.getElementById('report-period-select');
        periodSelect.innerHTML = '';
        getAvailablePeriods(parseInt(year), type).forEach((p, index) => {
            periodSelect.innerHTML += `<option value="${index}">${p.label}</option>`;
        });
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
        
        const previousStart = new Date(current.start);
        previousStart.setMonth(previousStart.getMonth() - monthsPerPeriod);
        const previousEnd = new Date(current.start);
        previousEnd.setDate(previousEnd.getDate() - 1);

        return { current, previous: { start: previousStart, end: previousEnd }, label: current.label };
    };

    return { init, loadDashboardData };
})();

window.APP_MODULES.estadisticas = (() => {
    let analysisChart = null;

    const init = (container) => {
        const today = new Date().toISOString().split('T')[0];
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const startDate = oneMonthAgo.toISOString().split('T')[0];
        
        const establishmentFilterHTML = appState.profile.rol === 'admin' ? `
            <div>
                <label class="font-medium">Establecimiento</label>
                <select id="filter-establishment" class="form-input mt-1">
                    <option value="all">Toda la Red</option>
                    ${appState.allEstablishments.map(e => `<option value="${e.source}-${e.id}">${e.nombre}</option>`).join('')}
                </select>
            </div>
        ` : '';

        const wasteTypeFilterHTML = `
            <div>
                <label class="font-medium">Tipo de Residuo</label>
                <select id="filter-waste-type" class="form-input mt-1">
                    <option value="all">Todos</option>
                    <option value="special_waste">Especiales (REAS)</option>
                    <option value="hazardous_waste">Peligrosos</option>
                    <option value="assimilable_waste">Asimilables</option>
                    <option value="radioactive_waste">Radiactivos</option>
                </select>
            </div>`;

        const unitOptions = appState.unitsCache.map(u => `<option value="${u.id}">${u.name}</option>`).join('');

        container.innerHTML = `
            <h1 class="text-3xl font-bold text-gray-800 mb-6">Análisis y Estadísticas</h1>
            <div class="section-card mb-8">
                <div class="grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                    ${establishmentFilterHTML}
                    ${wasteTypeFilterHTML}
                    <div><label class="font-medium">Fecha Inicio</label><input type="date" id="filter-start-date" class="form-input mt-1" value="${startDate}"></div>
                    <div><label class="font-medium">Fecha Fin</label><input type="date" id="filter-end-date" class="form-input mt-1" value="${today}"></div>
                    <div class="md:col-span-2"><label class="font-medium">Unidades</label><select id="filter-units" class="form-input mt-1" multiple>${unitOptions}</select></div>
                    <button id="apply-filters-btn" class="btn btn-primary self-end">Aplicar Filtros</button>
                </div>
            </div>
            <div id="analysis-results" class="hidden">
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div class="lg:col-span-2 section-card">
                        <h2 class="text-xl font-semibold mb-4">Tabla de Datos Agrupados</h2>
                        <div id="analysis-table-container" class="overflow-x-auto centered-analysis-table"></div>
                    </div>
                    <div class="section-card">
                        <h2 class="text-xl font-semibold mb-4">Composición de Residuos</h2>
                        <div class="relative h-80"><canvas id="analysisChart"></canvas></div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('apply-filters-btn').addEventListener('click', runAnalysis);
        if(appState.profile.rol === 'admin') {
            document.getElementById('filter-establishment').addEventListener('change', updateUnitFilter);
        }
        runAnalysis();
    };

    const updateUnitFilter = () => {
        const establishmentFilter = document.getElementById('filter-establishment');
        if(!establishmentFilter) return;
        
        const establishmentValue = establishmentFilter.value;
        const unitSelect = document.getElementById('filter-units');
        let filteredUnits = appState.unitsCache;
        if (establishmentValue && establishmentValue !== 'all') {
            const [src, estId] = establishmentValue.split(/-(.+)/);
            if(src === 'hpl'){
                 filteredUnits = appState.unitsCache.filter(u => u.source === src);
            } else {
                 filteredUnits = appState.unitsCache.filter(u => u.source === src && String(u.establecimiento_id) === String(estId));
            }
        }
        unitSelect.innerHTML = filteredUnits.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    };
    const runAnalysis = async () => {
        const resultsContainer = document.getElementById('analysis-results');
        resultsContainer.classList.remove('hidden');
        resultsContainer.querySelector('#analysis-table-container').innerHTML = `<div class="loader-container"><div class="loader"></div></div>`;

        const startDate = document.getElementById('filter-start-date').value;
        const endDate = document.getElementById('filter-end-date').value;
        const selectedUnitOptions = Array.from(document.getElementById('filter-units').selectedOptions);
        const selectedUnits = selectedUnitOptions.map(opt => opt.value);
        const establishmentValue = (document.getElementById('filter-establishment')?.value || `${appState.establishment?.source}-${appState.establishment?.id}`);
        const wasteType = document.getElementById('filter-waste-type')?.value || 'all';

        let allData = [];
        const allWasteTables = ['special_waste', 'hazardous_waste', 'assimilable_waste', 'radioactive_waste'];
        const wasteTables = wasteType === 'all' ? allWasteTables : [wasteType];

        let sourcesToQuery = [];
        if (appState.profile.rol === 'admin' && establishmentValue === 'all') {
            sourcesToQuery = Object.keys(supabaseClients);
        } else {
            if (establishmentValue && establishmentValue.includes('-')) {
                const [src] = establishmentValue.split(/-(.+)/);
                sourcesToQuery = [src];
            } else if (appState.profile.rol === 'admin') {
                sourcesToQuery = [establishmentValue];
            } else {
                sourcesToQuery = [appState.establishment.source];
            }
        }
        
        const selectedUnitIdsBySource = {};
        selectedUnits.forEach(uid => {
            const unit = appState.unitsCache.find(u => String(u.id) === String(uid));
            if (unit) {
                if (!selectedUnitIdsBySource[unit.source]) selectedUnitIdsBySource[unit.source] = [];
                selectedUnitIdsBySource[unit.source].push(unit.id);
            }
        });

        for (const source of sourcesToQuery) {
            const client = getSupabaseClient(source);
            let establishmentIdFilter = null;
            if (establishmentValue !== 'all' && establishmentValue.includes('-')) {
                const parts = establishmentValue.split(/-(.+)/);
                if (parts[0] === source) {
                    establishmentIdFilter = parts[1];
                }
            } else if(appState.profile.rol !== 'admin' && appState.establishment.source === source){
                establishmentIdFilter = appState.establishment.id;
            }

            for (const tableName of wasteTables) {
                if (tableName === 'radioactive_waste' && source === 'hpl') continue;
                
                let selectString;
                if (tableName === 'assimilable_waste') {
                    selectString = source === 'sst'
                        ? 'date, weight_kg, unit_id, units(name, establecimiento_id)'
                        : 'date, weight_kg, unit_id, units(name)';
                } else {
                    selectString = source === 'sst'
                        ? 'date, weight_kg, waste_type, unit_id, units(name, establecimiento_id)'
                        : 'date, weight_kg, waste_type, unit_id, units(name)';
                }

                let query = client
                    .from(tableName)
                    .select(selectString)
                    .gte('date', startDate)
                    .lte('date', endDate);
                
                if (selectedUnits.length > 0) {
                    const unitIdsForThisSource = selectedUnitIdsBySource[source] || [];
                    query = unitIdsForThisSource.length > 0 ? query.in('unit_id', unitIdsForThisSource) : query.eq('unit_id', -1);
                } else if(establishmentIdFilter && source === 'sst') {
                     query = query.eq('units.establecimiento_id', establishmentIdFilter);
                }
                
                try {
                    const data = await fetchAll(query);
                    if (data) {
                        allData.push(...data.map(d => ({ ...d, type: tableName, source })));
                    }
                } catch(e) {
                    console.error(`Failed to fetch ${tableName} from ${source}:`, e);
                }
            }
        }

        const totals = { special: 0, hazardous: 0, assimilable: 0, radioactive: 0 };
        const details = { special: [], hazardous: [], assimilable: [], radioactive: [] };
        
        allData.forEach(r => {
            const key = r.type.replace('_waste', '');
            const weight = parseFloat(r.weight_kg || 0);
            totals[key] += weight;

            let unitName = r.units?.name || `Unidad ID ${r.unit_id}`;
            const wasteCat = r.waste_type || (key === 'assimilable' ? 'Asimilable' : 'Otro');
            
            let establishmentName;
            const est = appState.allEstablishments.find(e => {
                if (r.source === 'hpl') return e.source === 'hpl';
                return e.source === 'sst' && r.units && String(e.id) === String(r.units.establecimiento_id);
            });
            if (est) {
                establishmentName = est.nombre;
            } else if (appState.profile.rol !== 'admin' && appState.establishment) {
                establishmentName = appState.establishment.nombre;
            } else {
                establishmentName = (r.source === 'hpl' ? 'Hospital Penco Lirquén' : supabaseClients[r.source].name);
            }

            details[key].push({ 
                unit: unitName, 
                category: wasteCat, 
                weight: weight,
                establishment: establishmentName
            });
        });

        renderAnalysisTable(totals, details);
        renderAnalysisChart(totals);
    };

    const renderAnalysisTable = (totals, details) => {
        const container = document.getElementById('analysis-table-container');
        const totalGeneral = Object.values(totals).reduce((sum, val) => sum + val, 0);
        const typeOrder = ['special', 'hazardous', 'assimilable', 'radioactive'];
        const typeLabels = { special: 'Especiales (REAS)', hazardous: 'Peligrosos', assimilable: 'Asimilables', radioactive: 'Radiactivos' };
        let rowsHTML = '';

        typeOrder.forEach(key => {
            const total = totals[key] || 0;
            const percentage = totalGeneral > 0 ? (total / totalGeneral) * 100 : 0;
            const detList = details[key] || [];
            let detContent = `<p class="p-2 text-sm text-gray-500">Sin detalles para este período.</p>`;

            if (detList.length > 0) {
                const groupedByUnit = detList.reduce((acc, curr) => {
                    const groupKey = `${curr.establishment}__${curr.unit}`;
                    if (!acc[groupKey]) {
                        acc[groupKey] = { 
                            establishment: curr.establishment, 
                            unit: curr.unit, 
                            totalWeight: 0,
                            subcategories: {}
                        };
                    }
                    acc[groupKey].totalWeight += curr.weight;
                    acc[groupKey].subcategories[curr.category] = (acc[groupKey].subcategories[curr.category] || 0) + curr.weight;
                    return acc;
                }, {});

                const sortedUnits = Object.values(groupedByUnit).sort((a, b) => b.totalWeight - a.totalWeight);
                
                const isAdminView = appState.profile.rol === 'admin';
                const establishmentHeader = isAdminView ? `<th data-sortable="true" style="cursor:pointer;">Establecimiento</th>` : '';
                
                let detailRows = '';
                sortedUnits.forEach(({ establishment, unit, totalWeight, subcategories }) => {
                    const establishmentColumn = isAdminView ? `<td>${establishment}</td>` : '';
                    let subcatDetailRows = '';
                     if ((key === 'special' || key === 'hazardous')) {
                         const subcatRows = Object.entries(subcategories).sort((a,b) => b[1] - a[1]).map(([name, weight]) => `
                            <tr>
                                <td>${unit}</td>
                                ${establishmentColumn}
                                <td>${name}</td>
                                <td>${weight.toFixed(2)} kg</td>
                            </tr>`).join('');
                        subcatDetailRows += subcatRows;
                    } else {
                        subcatDetailRows += `<tr><td>${unit}</td>${establishmentColumn}<td>${typeLabels[key]}</td><td>${totalWeight.toFixed(2)} kg</td></tr>`;
                    }
                    detailRows += subcatDetailRows;
                });

                detContent = `
                    <table class="w-full text-sm sortable-table">
                         <thead>
                             <tr class="text-xs text-gray-700 uppercase bg-gray-100">
                                <th data-sortable="true" style="cursor:pointer;">Unidad</th>
                                ${establishmentHeader}
                                <th data-sortable="true" style="cursor:pointer;">Categoría/Subcategoría</th>
                                <th data-sortable="true" style="cursor:pointer;">Peso (kg)</th>
                             </tr>
                         </thead>
                         <tbody>${detailRows}</tbody>
                    </table>`;
            }

            rowsHTML += `
                <tr class="border-b data-row" data-type="${key}">
                    <td class="py-2 px-3 font-medium flex items-center justify-center gap-2">
                        <button class="toggle-details-btn text-indigo-600 hover:text-indigo-800" data-type="${key}" title="Mostrar/Ocultar detalles"><i class="fas fa-chevron-right transition-transform"></i></button>
                        ${typeLabels[key]}
                    </td>
                    <td class="py-2 px-3">${total.toFixed(2)}</td>
                    <td class="py-2 px-3">${percentage.toFixed(2)}%</td>
                </tr>
                <tr id="details-${key}" class="details-row hidden">
                    <td colspan="3" class="p-2 bg-gray-50">${detContent}</td>
                </tr>`;
        });

        container.innerHTML = `
            <table class="w-full text-sm">
                <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                    <tr>
                        <th class="px-3 py-3">Tipo de Residuo</th>
                        <th class="px-3 py-3">Peso Total (kg)</th>
                        <th class="px-3 py-3">% del Total</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
                <tfoot class="font-bold bg-gray-50">
                    <tr>
                        <td class="py-2 px-3">Total General</td>
                        <td class="py-2 px-3">${totalGeneral.toFixed(2)}</td>
                        <td class="py-2 px-3">100.00%</td>
                    </tr>
                </tfoot>
            </table>`;
            
        container.querySelectorAll('.toggle-details-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                const detailsRow = document.getElementById(`details-${type}`);
                detailsRow.classList.toggle('hidden');
                btn.querySelector('i').classList.toggle('rotate-90');
                if(!detailsRow.classList.contains('hidden')){
                    const table = detailsRow.querySelector('.sortable-table');
                    if(table) makeTableSortable(table);
                }
            });
        });
    };

    const renderAnalysisChart = (totals) => {
        const ctx = document.getElementById('analysisChart')?.getContext('2d');
        if (!ctx) return;
        if (analysisChart) analysisChart.destroy();
        analysisChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Especiales (REAS)', 'Peligrosos', 'Asimilables', 'Radiactivos'],
                datasets: [{
                    data: [totals.special || 0, totals.hazardous || 0, totals.assimilable || 0, totals.radioactive || 0],
                    backgroundColor: ['#f59e0b', '#ef4444', '#22c55e', '#8b5cf6']
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    };

    return { init };
})();

window.APP_MODULES.waste = (() => {
    const wasteTypes = [
        { id: 'special', tableName: 'special_waste', title: 'Especiales (REAS)', icon: 'fa-biohazard', color: 'text-yellow-600', singularName: 'Registro REAS' },
        { id: 'hazardous', tableName: 'hazardous_waste', title: 'Peligrosos', icon: 'fa-triangle-exclamation', color: 'text-red-600', singularName: 'Registro Peligroso' },
        { id: 'assimilable', tableName: 'assimilable_waste', title: 'Asimilables', icon: 'fa-recycle', color: 'text-green-600', singularName: 'Registro Asimilable' },
        { id: 'radioactive', tableName: 'radioactive_waste', title: 'Radiactivos', icon: 'fa-radiation', color: 'text-purple-600', singularName: 'Registro Radiactivo' }
    ];

    const init = async (container) => {
        let tabsHTML = '';
        let tabContentHTML = '';
        const tableNames = wasteTypes.map(type => type.tableName);
        const filterInterface = createFilterInterface(tableNames);


        for (const type of wasteTypes) {
            if (appState.profile.rol !== 'admin' && appState.establishment?.source === 'hpl' && type.tableName === 'radioactive_waste') {
                continue;
            }

            const isActive = type.id === 'special';
            tabsHTML += `<button class="waste-tab-btn ${isActive ? 'active' : ''}" data-tab-id="${type.id}"><i class="fas ${type.icon} ${type.color} mr-2"></i><span>${type.title}</span></button>`;
            const formFieldsHTML = await getFormFields(type.tableName);
            const csvInterfaceHTML = createCSVInterface(type.tableName, type.singularName);
            tabContentHTML += `
                <div id="tab-content-${type.id}" class="waste-tab-content ${isActive ? '' : 'hidden'}">
                    <div class="section-card">
                        <div class="flex flex-wrap gap-4 mb-4">
                            <details class="flex-grow">
                                <summary class="btn btn-secondary btn-sm cursor-pointer">Añadir Nuevo ${type.singularName}</summary>
                                <form id="form-${type.tableName}" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 p-4 bg-gray-50 rounded-lg">
                                    ${formFieldsHTML}
                                    <div class="md:col-span-full flex justify-end"><button type="submit" class="btn btn-primary">Añadir ${type.singularName}</button></div>
                                </form>
                            </details>
                            ${csvInterfaceHTML}
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm">
                                <thead class="text-xs text-gray-700 uppercase bg-gray-100"><tr></tr></thead>
                                <tbody id="list-${type.tableName}"></tbody>
                            </table>
                        </div>
                        <div id="pagination-${type.tableName}" class="flex justify-center items-center gap-4 mt-4"></div>
                    </div>
                </div>`;
        }

        container.innerHTML = `
            <h1 class="text-3xl font-bold text-gray-800 mb-2">Gestión de Residuos</h1>
            ${filterInterface}
            <div class="flex border-b border-gray-200 mb-6">${tabsHTML}</div>
            <div>${tabContentHTML}</div>`;

        wasteTypes.forEach(type => {
            if (document.getElementById(`form-${type.tableName}`)) {
                setupCRUD(type.tableName, type.singularName);
            }
        });
        setupEventListeners();
        setupFilterListeners(tableNames);
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
        
        document.getElementById('main-content').addEventListener('change', (e) => {
            if (e.target.id === 'form-establishment-selector') {
                const form = e.target.closest('form');
                const unitSelect = form.querySelector('select[name="unit_id"]');
                const selectedEst = e.target.value;

                if (!selectedEst) {
                    unitSelect.innerHTML = '<option value="">Seleccione primero un establecimiento</option>';
                    return;
                }
                
                const [source, estId] = selectedEst.split(/-(.+)/);
                const unitsInView = appState.unitsCache.filter(u => u.source === source && (source === 'hpl' || String(u.establecimiento_id) === String(estId)));
                unitSelect.innerHTML = unitsInView.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
            }
        });
    };

    return { init };
})();

const createSimpleCrudModule = (config) => ({
    init: async (container) => {
        let sectionsHTML = '';
        const tableNames = config.sections.map(sec => sec.tableName);
        const filterInterface = config.hasFilters ? createFilterInterface(tableNames) : '';

        for (const sec of config.sections) {
            const formFieldsHTML = await getFormFields(sec.tableName);
            const csvInterfaceHTML = createCSVInterface(sec.tableName, sec.singularName);
            sectionsHTML += `
            <div class="section-card mb-8">
                <h2 class="text-xl font-semibold mb-4">${sec.title}</h2>
                <div class="flex flex-wrap gap-4 mb-4">
                    <details class="flex-grow">
                        <summary class="btn btn-secondary btn-sm cursor-pointer">Añadir Nuevo ${sec.singularName}</summary>
                        <form id="form-${sec.tableName}" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 p-4 bg-gray-50 rounded-lg">
                            ${formFieldsHTML}
                            <div class="md:col-span-full flex justify-end"><button type="submit" class="btn btn-primary">Añadir ${sec.singularName}</button></div>
                        </form>
                    </details>
                    ${csvInterfaceHTML}
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100"><tr></tr></thead>
                        <tbody id="list-${sec.tableName}"></tbody>
                    </table>
                </div>
                <div id="pagination-${sec.tableName}" class="flex justify-center items-center gap-4 mt-4"></div>
            </div>`;
        }
        container.innerHTML = `<h1 class="text-3xl font-bold text-gray-800 mb-6">${config.title}</h1>${filterInterface}${sectionsHTML}`;
        config.sections.forEach(sec => setupCRUD(sec.tableName, sec.singularName));
        if(config.hasFilters) {
            setupFilterListeners(tableNames);
        }
    }
});

window.APP_MODULES.inventory = createSimpleCrudModule({
    title: "Gestión de Inventario",
    hasFilters: true,
    sections: [
        { title: "Catálogo de Insumos", singularName: 'Insumo', tableName: 'supplies' },
        { title: "Recepción de Insumos", singularName: 'Recepción', tableName: 'supply_arrivals' },
        { title: "Entrega de Insumos", singularName: 'Entrega', tableName: 'supply_deliveries' },
        { title: "Puntos de Residuos (Contenedores)", singularName: 'Contenedor', tableName: 'containers' }
    ]
});
window.APP_MODULES.agreements = createSimpleCrudModule({ title: "Gestión de Convenios y Facturación", sections: [{ title: "Convenios de Retiro", singularName: 'Convenio', tableName: 'waste_removal_agreements' }, { title: "Facturación Mensual (OC)", singularName: 'Factura', tableName: 'monthly_invoices' }] });
window.APP_MODULES.settings = createSimpleCrudModule({ title: "Configuración", sections: [{ title: "Gestión de Unidades", singularName: 'Unidad', tableName: 'units' }] });

window.APP_MODULES.wastePoints = (() => {

    const wasteTypesInfo = {
        'Asimilables': { color: 'bg-green-500', name: 'Asimilables', icon: 'fa-trash-alt' },
        'Peligrosos': { color: 'bg-red-500', name: 'Peligrosos', icon: 'fa-skull-crossbones' },
        'Especiales (REAS)': { color: 'bg-yellow-500', name: 'Especiales', icon: 'fa-biohazard' },
        'Radiactivos': { color: 'bg-blue-500', name: 'Radiactivos', icon: 'fa-atom' }
    };

    const init = (container) => {
        container.innerHTML = `
            <header class="text-left mb-8">
                <h1 class="text-3xl font-bold text-gray-800">Mapa de Puntos de Residuos</h1>
                <p class="text-gray-600 mt-1">Visualización jerárquica de contenedores por edificio, piso y unidad.</p>
            </header>
            <div id="hospital-layout" class="space-y-3 max-w-full mx-auto">
                 <div class="flex justify-center items-center p-10"><div class="loader"></div><p class="ml-4 text-gray-500">Cargando mapa de puntos...</p></div>
            </div>
            <div id="waste-point-modal" class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center hidden z-50 p-4">
                <div id="modal-content" class="bg-white rounded-lg shadow-xl p-6 w-full max-w-md relative">
                    <button id="close-modal-btn" class="absolute top-3 right-3 text-gray-400 hover:text-gray-700"><i class="fas fa-times fa-lg"></i></button>
                    <div id="modal-body" class="space-y-3"></div>
                </div>
            </div>`;

        renderLayout();
    };

    const renderLayout = async () => {
        const layoutContainer = document.getElementById('hospital-layout');
        if (!layoutContainer) return;

        let allContainers = [];
        try {
            const isAdminGlobalView = appState.profile.rol === 'admin' && appState.globalEstablishmentFilter === 'all';
            
            if(isAdminGlobalView) {
                const sstPromise = fetchAll(supabaseSST.from('containers').select(getSelectStringForTable('containers', 'sst')));
                const hplPromise = fetchAll(supabaseHPL.from('containers').select(getSelectStringForTable('containers', 'hpl')));
                
                const [sstContainers, hplContainers] = await Promise.all([sstPromise, hplPromise]);
                
                allContainers = [
                    ...(sstContainers || []).map(c => ({...c, hospitalName: 'SST'})),
                    ...(hplContainers || []).map(c => ({...c, hospitalName: 'HPL'}))
                ];

            } else {
                let client, source, establishmentIdToFilter;
                if (appState.profile.rol === 'admin' && appState.globalEstablishmentFilter !== 'all') {
                    [source, establishmentIdToFilter] = appState.globalEstablishmentFilter.split(/-(.+)/);
                    client = getSupabaseClient(source);
                } else {
                    source = appState.establishment.source;
                    client = getSupabaseClient(source);
                    establishmentIdToFilter = appState.establishment.id;
                }
                
                const selectString = getSelectStringForTable('containers', source);
                let query = client.from('containers').select(selectString);
                
                if (source === 'sst' && establishmentIdToFilter) {
                    const unitIds = appState.unitsCache.filter(u => u.source === 'sst' && String(u.establecimiento_id) === String(establishmentIdToFilter)).map(u => u.id);
                    if (unitIds.length > 0) {
                        query = query.in('unit_id', unitIds);
                    } else {
                        query = query.eq('unit_id', -1); 
                    }
                }
                
                const data = await fetchAll(query);
                allContainers = (data || []).map(c => ({...c, hospitalName: supabaseClients[source].name}));
            }
        } catch(error) {
            layoutContainer.innerHTML = `<p class="text-red-500 text-center p-10">Error al cargar los contenedores: ${error.message}</p>`;
            console.error(error);
            return;
        }

        const hospitalData = allContainers.reduce((acc, container) => {
            if (!container.units) return acc;
            
            const establishmentName = container.units.establecimiento?.nombre || container.hospitalName;
            const building = container.units.building || 'Edificio No Especificado';
            const floor = container.units.floor || 'Piso No Especificado';
            const unitName = container.units.name;

            const buildingKey = `${establishmentName} - ${building}`;

            if (!acc[buildingKey]) acc[buildingKey] = {};
            if (!acc[buildingKey][floor]) acc[buildingKey][floor] = {};
            if (!acc[buildingKey][floor][unitName]) acc[buildingKey][floor][unitName] = [];

            acc[buildingKey][floor][unitName].push(container);
            return acc;
        }, {});

        layoutContainer.innerHTML = '';

        if (Object.keys(hospitalData).length === 0) {
            layoutContainer.innerHTML = '<p class="text-gray-500 text-center p-10">No se encontraron contenedores registrados con unidades válidas.</p>';
            return;
        }

        Object.keys(hospitalData).sort().forEach(buildingKey => {
            const buildingDiv = document.createElement('div');
            buildingDiv.className = 'building-accordion bg-white rounded-lg shadow-sm border border-gray-200';
            const floors = hospitalData[buildingKey];
            let floorsHTML = '';

            Object.keys(floors).sort().forEach(floorName => {
                const units = floors[floorName];
                let unitsHTML = '';

                Object.keys(units).sort().forEach(unitName => {
                    const wastePoints = units[unitName];
                    if (wastePoints.length === 0) return;

                    const pointsHTML = wastePoints.map(point => {
                        const typeInfo = wasteTypesInfo[point.waste_usage_type] || { color: 'bg-gray-400', name: 'N/A', icon: 'fa-question-circle' };
                        return `
                            <div class="waste-point-icon ${typeInfo.color}" data-point-details='${JSON.stringify(point)}' title="${point.container_type} (${point.capacity_liters}L) - ${typeInfo.name}">
                                <i class="fas ${typeInfo.icon}"></i>
                                <span>${point.capacity_liters}L</span>
                            </div>`;
                    }).join('');

                    unitsHTML += `
                        <div class="unit-container">
                            <h4 class="font-semibold text-gray-700 text-sm mb-2">${unitName}</h4>
                            <div class="flex flex-wrap gap-2">${pointsHTML}</div>
                        </div>`;
                });

                if (unitsHTML) {
                    floorsHTML += `<div class="p-4 border-t border-gray-200">
                                       <h3 class="text-md font-bold text-gray-800">${floorName}</h3>
                                       ${unitsHTML}
                                   </div>`;
                }
            });

            if (floorsHTML) {
                buildingDiv.innerHTML = `
                    <div class="building-header p-4 flex justify-between items-center cursor-pointer">
                        <h2 class="text-xl font-bold text-gray-700 flex items-center"><i class="fas fa-building mr-3 text-gray-400"></i>${buildingKey}</h2>
                        <i class="fas fa-chevron-down accordion-icon text-gray-500 transition-transform"></i>
                    </div>
                    <div class="floors-container">${floorsHTML}</div>`;
                layoutContainer.appendChild(buildingDiv);
            }
        });

        setupEventListeners();
    };

    const setupEventListeners = () => {
        document.querySelectorAll('.building-header').forEach(header => {
            header.addEventListener('click', () => {
                const floorsContainer = header.nextElementSibling;
                const icon = header.querySelector('.accordion-icon');
                const isExpanded = floorsContainer.classList.contains('expanded');

                floorsContainer.classList.toggle('expanded', !isExpanded);
                icon.classList.toggle('rotate-180');
            });
        });

        const modal = document.getElementById('waste-point-modal');
        const closeModalBtn = document.getElementById('close-modal-btn');
        const modalBody = document.getElementById('modal-body');

        document.getElementById('hospital-layout').addEventListener('click', function (event) {
            const wastePoint = event.target.closest('.waste-point-icon');
            if (wastePoint) {
                const details = JSON.parse(wastePoint.dataset.pointDetails);
                const typeInfo = wasteTypesInfo[details.waste_usage_type] || { color: 'bg-gray-400', name: 'Desconocido' };

                modalBody.innerHTML = `
                    <h3 class="text-xl font-bold text-gray-800 flex items-center"><div class="w-4 h-4 rounded-full ${typeInfo.color} mr-3"></div>${details.waste_usage_type}</h3>
                    <div class="text-sm text-gray-600 space-y-1 mt-4">
                        <p><strong>Referencia:</strong> ${details.container_reference}</p>
                        <p><strong>Unidad:</strong> <span class="font-medium text-indigo-600">${details.units?.name || 'N/A'}</span></p>
                        <p><strong>Tipo Contenedor:</strong> ${details.container_type}</p>
                        <p><strong>Capacidad:</strong> ${details.capacity_liters ? `${details.capacity_liters} L` : 'N/A'}</p>
                    </div>
                `;
                modal.classList.remove('hidden');
            }
        });

        function closeModal() { modal.classList.add('hidden'); }
        closeModalBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    };

    return { init };
})();

// ---------------------------------------------------------------------------------
// PARTE 9: PUNTO DE ENTRADA Y LÓGICA DE INICIALIZACIÓN
// ---------------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    if (document.body.id !== 'login-page') {
        Auth.checkAuth().then(profile => {
            if (profile) {
                mainApp();
            }
        });
    }
});

async function mainApp() {
    await Promise.all([loadAllEstablishments(), loadUnitsCache(), loadSuppliesCache(), loadAgreementsCache()]);

    populateNavbar();
    setupTabs();
    await setupUserProfile();

    if (!appState.establishment && appState.profile.rol !== 'admin') {
        showEstablishmentSelector();
    } else {
        loadTabContent('dashboard');
    }
}


async function showEstablishmentSelector() {
    const contentArea = document.getElementById('main-content');
    const { data: establishments } = await supabaseSST.from('establecimientos').select('*');
    const options = establishments.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
    contentArea.innerHTML = `
        <div class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center">
            <div class="bg-white rounded-lg p-8 shadow-xl max-w-md w-full">
                <h2 class="text-2xl font-bold mb-4">Seleccione su Establecimiento</h2>
                <p class="text-gray-600 mb-6">Para continuar, por favor asigne un establecimiento a su cuenta.</p>
                <form id="establishment-form">
                    <select name="establishment_id" class="form-input" required><option value="">-- Seleccionar --</option>${options}</select>
                    <button type="submit" class="btn btn-primary w-full mt-6">Guardar y Continuar</button>
                </form>
            </div>
        </div>
    `;
    document.getElementById('establishment-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const error = await Auth.updateProfile(appState.user.id, { establecimiento_id: e.target.establishment_id.value });
        if (error) alert("Error al guardar el establecimiento.");
        else window.location.reload();
    });
}

function populateNavbar() {
    const nav = document.getElementById('main-nav');
    if (nav) {
        nav.innerHTML = window.APP_CONFIG.navItems.map(item => `
            <a href="#" class="tab-btn" data-tab="${item.id}" title="${item.text}">
                ${item.icon} <span class="hidden lg:block">${item.text}</span>
            </a>`).join('');
    }
}

function setupTabs() {
    const nav = document.getElementById('main-nav');
    if (nav) {
        nav.addEventListener('click', (e) => {
            const tabButton = e.target.closest('.tab-btn');
            if (tabButton) {
                e.preventDefault();
                nav.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
                tabButton.classList.add('active');
                loadTabContent(tabButton.dataset.tab);
            }
        });
        const firstTab = nav.querySelector('.tab-btn');
        if (firstTab) firstTab.classList.add('active');
    }
}

async function setupUserProfile() {
    const userProfileEl = document.getElementById('user-profile');
    const establishmentNameEl = document.getElementById('establishment-name');

    if (appState.profile && userProfileEl) {
        const email = appState.user.email;
        const initial = email ? email.charAt(0).toUpperCase() : '?';
        let establishmentName = 'Sin asignar';
        let establishmentFilterHTML = '';
        
        if (appState.profile.rol === 'admin') {
            establishmentName = 'Administrador General';
             if(establishmentNameEl) establishmentNameEl.textContent = 'Modo Administrador';
            const options = appState.allEstablishments.map(e => `<option value="${e.source}-${e.id}">${e.nombre}</option>`).join('');
            establishmentFilterHTML = `
                <div class="px-2 pt-2 border-t mt-2">
                    <label class="text-xs font-semibold text-gray-600 hidden lg:block">Filtrar Vista</label>
                    <select id="global-establishment-filter" class="form-input mt-1 w-full text-xs p-1">
                        <option value="all">Toda la Red</option>
                        ${options}
                    </select>
                </div>`;
        } else if (appState.establishment) {
            establishmentName = appState.establishment.nombre;
            if(establishmentNameEl) establishmentNameEl.textContent = establishmentName;
        }

        userProfileEl.innerHTML = `
            <div class="flex items-center p-2">
                <div class="w-10 h-10 rounded-full bg-indigo-200 flex items-center justify-center font-bold text-indigo-600" title="${email}">${initial}</div>
                <div class="ml-3 hidden lg:block">
                    <p class="text-sm font-semibold text-gray-700 truncate max-w-[150px]">${appState.profile.nombre_completo || email}</p>
                    <p class="text-xs text-gray-500">${establishmentName}</p>
                </div>
            </div>
            ${establishmentFilterHTML}
            <div class="px-2 pt-2 ${!establishmentFilterHTML ? 'border-t mt-2' : ''}"><button id="logout-btn" class="btn btn-secondary btn-sm w-full">Cerrar Sesión</button></div>`;

        document.getElementById('logout-btn').addEventListener('click', () => Auth.signOut());

        if (appState.profile.rol === 'admin') {
            const filterSelect = document.getElementById('global-establishment-filter');
            filterSelect.value = appState.globalEstablishmentFilter;
            filterSelect.addEventListener('change', async (e) => {
                appState.globalEstablishmentFilter = e.target.value;
                const [source] = appState.globalEstablishmentFilter.split(/-(.+)/);
                appState.currentClient = getSupabaseClient(source);
                const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'dashboard';
                await loadUnitsCache();
                await loadSuppliesCache();
                loadTabContent(activeTab);
            });
        }
    }
}

function loadTabContent(tabName) {
    const contentArea = document.getElementById('main-content');
    if (!contentArea) return;
    appState.globalListFilters = {}; // Reset filters when changing tabs
    contentArea.innerHTML = `<div class="loader-container"><div class="loader"></div></div>`;
    const module = window.APP_MODULES[tabName];
    if (module && typeof module.init === 'function') {
        setTimeout(() => module.init(contentArea), 50);
    } else {
        contentArea.innerHTML = `<div class="text-center p-10"><h2 class="text-xl font-semibold">Módulo '${tabName}' en construcción.</h2></div>`;
    }
}

