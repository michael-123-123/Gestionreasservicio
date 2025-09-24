document.addEventListener('DOMContentLoaded', () => {

    // ---------------------------------------------------------------------------------
    // PARTE 1: CONFIGURACIÓN Y CLIENTES DE SUPABASE
    // ---------------------------------------------------------------------------------
    const { createClient } = window.supabase;

    const SUPABASE_URL_SST = 'https://mddxfoldoxtofjvevmfg.supabase.co';
    const SUPABASE_ANON_KEY_SST = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kZHhmb2xkb3h0b2ZqdmV2bWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3ODY3NjQsImV4cCI6MjA3MTM2Mjc2NH0.qgWe16qCy42PpvM10xZDT2Nxzvv3VL-rI4xyZjxROEg';

    const SUPABASE_URL_HPL = 'https://peiuznumhjdynbffabyq.supabase.co';
    const SUPABASE_ANON_KEY_HPL = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlaXV6bnVtaGpkeW5iZmZhYnlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3MTE4NTksImV4cCI6MjA3NDI4Nzg1OX0.T6KloEC3W-fpnaqNYxlNWV0aT4FyzxwPUD0UhcqvuJM';

    const supabaseSST = createClient(SUPABASE_URL_SST, SUPABASE_ANON_KEY_SST);
    const supabaseHPL = createClient(SUPABASE_URL_HPL, SUPABASE_ANON_KEY_HPL, {
        auth: { persistSession: false }
    });

    const supabaseClients = {
        sst: { client: supabaseSST, name: 'SST' },
        hpl: { client: supabaseHPL, name: 'HPL' }
    };
    window.supabase = supabaseSST;

    // ---------------------------------------------------------------------------------
    // PARTE 2: ESTADO GLOBAL DE LA APLICACIÓN
    // ---------------------------------------------------------------------------------
    let appState = { user: null, profile: null, establishment: null, unitsCache: [], suppliesCache: [], agreementsCache: [], allEstablishments: [], globalEstablishmentFilter: 'all', currentClient: supabaseSST, globalListFilters: {} };

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

            const { error: sessionError } = await supabaseHPL.auth.setSession(session);
            if (sessionError) {
                console.error("Error setting session on HPL client:", sessionError);
                throw new Error(`Authentication failure with secondary database: ${sessionError.message}`);
            }

            appState.user = session.user;

            let { data: profile, error } = await supabaseSST
                .from('perfiles')
                .select('*, establecimiento:establecimientos(id, nombre)')
                .eq('id', session.user.id)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
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
                appState.establishment = isHPLUser ? { id: 1, nombre: 'Hospital Penco Lirquén', source: 'hpl' } : null;
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
    
    // =================================================================================
    // COMIENZO DEL CÓDIGO ORIGINAL DE LA APLICACIÓN
    // =================================================================================
    
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
        } else {
             appState.unitsCache = [];
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
        } else {
            appState.suppliesCache = [];
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
        } else {
             appState.agreementsCache = [];
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
                if(appState.profile.rol !== 'admin' && appState.establishment) {
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
                    <div id="kpi-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8"></div>
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

        const populateDynamicYearFilter = async () => { /* ... */ };
        const loadDashboardData = async () => { /* ... */ };
        const renderKPIs = () => { /* ... */ };
        const renderWasteCharts = () => { /* ... */ };
        const generateProfessionalReport = async () => { /* ... */ };
        const downloadReportAsPDF = async () => { /* ... */ };
        const processMonthlyAnnexData = (yearlyWasteData) => { /* ... */ };
        const processConsolidatedBreakdown = (currentWaste) => { /* ... */ };
        const groupWaste = (wasteData) => { /* ... */ };
        const processAdvancedReportData = (sourceData) => { /* ... */ };
        const renderAdvancedReport = (data) => { /* ... */ };
        const renderReportCharts = (data) => { /* ... */ };
        const getMonthlyRanges = (startDate, endDate) => { /* ... */ };
        const fetchAllDataFromAllDBs = async (tableName, select) => { /* ... */ };
        const getInvoiceDataForPeriod = async (startDate, endDate, fetchAllDbs) => { /* ... */ };
        const getWasteDataForPeriod = async (startDate, endDate, fetchAllDbs = false) => { /* ... */ };
        const updatePeriodSelector = () => { /* ... */ };
        const getAvailablePeriods = (year, type) => { /* ... */ };
        const getDateRanges = (year, type, index) => { /* ... */ };

        return { init, loadDashboardData };
    })();

    window.APP_MODULES.estadisticas = (() => {
        let analysisChart = null;
        const init = (container) => { /* ... */ };
        const updateUnitFilter = () => { /* ... */ };
        const runAnalysis = async () => { /* ... */ };
        const renderAnalysisTable = (totals, details) => { /* ... */ };
        const renderAnalysisChart = (totals) => { /* ... */ };
        return { init };
    })();

    window.APP_MODULES.waste = (() => {
        const wasteTypes = [ /* ... */ ];
        const init = async (container) => { /* ... */ };
        const setupEventListeners = () => { /* ... */ };
        return { init };
    })();

    const createSimpleCrudModule = (config) => ({
        init: async (container) => { /* ... */ }
    });

    window.APP_MODULES.inventory = createSimpleCrudModule({ /* ... */ });
    window.APP_MODULES.agreements = createSimpleCrudModule({ /* ... */ });
    window.APP_MODULES.settings = createSimpleCrudModule({ /* ... */ });

    window.APP_MODULES.wastePoints = (() => {
        const wasteTypesInfo = { /* ... */ };
        const init = (container) => { /* ... */ };
        const renderLayout = async () => { /* ... */ };
        const setupEventListeners = () => { /* ... */ };
        return { init };
    })();
    
    // ---------------------------------------------------------------------------------
    // PARTE 9: PUNTO DE ENTRADA Y LÓGICA DE INICIALIZACIÓN
    // ---------------------------------------------------------------------------------
    async function mainApp() {
        await Promise.all([loadAllEstablishments(), loadUnitsCache(), loadSuppliesCache(), loadAgreementsCache()]);
        populateNavbar();
        setupTabs();
        await setupUserProfile();
        if (appState.profile.rol !== 'admin' && !appState.establishment) {
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


    // Lógica de arranque
    if (document.body.id === 'login-page') {
        const loginForm = document.getElementById('login-form');
        const signupForm = document.getElementById('signup-form');
        const toggleLink = document.getElementById('toggle-link');
        const errorMessage = document.getElementById('error-message');

        const toggleForms = (e) => {
            if (e) e.preventDefault();
            errorMessage.textContent = '';
            loginForm.classList.toggle('hidden');
            signupForm.classList.toggle('hidden');
            const isLoginVisible = !loginForm.classList.contains('hidden');
            document.getElementById('toggle-text').innerHTML = isLoginVisible
                ? '¿No tienes una cuenta? <a href="#" id="toggle-link" class="font-medium text-indigo-600 hover:text-indigo-500">Regístrate aquí</a>'
                : '¿Ya tienes una cuenta? <a href="#" id="toggle-link" class="font-medium text-indigo-600 hover:text-indigo-500">Inicia sesión</a>';
            document.getElementById('toggle-link').addEventListener('click', toggleForms);
        };
        toggleLink.addEventListener('click', toggleForms);

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            btn.disabled = true;
            btn.textContent = 'Ingresando...';
            const error = await window.Auth.signIn({ email: e.target.email.value, password: e.target.password.value });
            if (error) {
                errorMessage.textContent = `Error: ${error.message}`;
                btn.disabled = false;
                btn.textContent = 'Iniciar Sesión';
            }
        });

        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            btn.disabled = true;
            btn.textContent = 'Creando...';
            const error = await window.Auth.signUp({ email: e.target.email.value, password: e.target.password.value });
            if (error) {
                errorMessage.textContent = `Error: ${error.message}`;
                btn.disabled = false;
                btn.textContent = 'Crear Cuenta';
            }
        });
    } else {
        Auth.checkAuth().then(profile => {
            if (profile) {
                mainApp();
            }
        });
    }
});

