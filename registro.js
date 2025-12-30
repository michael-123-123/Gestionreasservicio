/**
 * =================================================================================================
 * GESTIÓNREAS - VISTA DE REGISTRO PARA AUXILIARES (VERSIÓN INTEGRAL V4.6 - ROBUST CONFIG)
 * =================================================================================================
 * CAMBIOS:
 * 1. [FIX] Función generateUUID() para compatibilidad HTTP.
 * 2. [FIX] Uso de getters (get config()) para evitar errores si app.js tarda en cargar APP_CONFIG.
 * =================================================================================================
 */

// Función auxiliar para generar IDs únicos en cualquier entorno (incluyendo HTTP)
function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Textos de interfaz centralizados
    const UI_TEXT = {
        loadingData: "Cargando datos maestros e inventario...",
        loadingError: "Error crítico al cargar datos. La aplicación puede no funcionar.",
        loadDataError: "No se pudieron cargar los datos necesarios. Intente recargar.",
        deleteConfirmTitle: "¿Eliminar Registro?",
        deleteConfirmText: "Esta acción no se puede deshacer.",
        deleteSuccess: "Registro eliminado correctamente.",
        deleteError: "Error al eliminar: ",
        saveSuccess: (count) => `${count} registro(s) guardado(s) con éxito.`,
        saveError: "Error al guardar: ",
        updateSuccess: "Registro actualizado correctamente.",
        updateError: "Error al actualizar: ",
        noSelection: "No ha seleccionado ninguna unidad.",
        signatureRequired: "La firma es obligatoria.",
        loanIDInvalid: "Error fatal: No se pudo identificar el préstamo.",
        printPrompt: "¿Imprimir Comprobante?",
        printLoanText: "¿Desea generar un comprobante en PDF para este préstamo?",
        printReturnText: "¿Desea generar un comprobante en PDF para esta devolución?",
        equipmentNotFound: "Error: Equipo no encontrado en el sistema.",
        historyLoadError: "Error al cargar el historial.",
        noHistory: "No hay historial disponible.",
    };

    // ===================================================================
    // 1. CONFIGURACIÓN INICIAL Y ESTADO
    // ===================================================================
    const appMain = document.getElementById('app-main');
    const userEmailEl = document.getElementById('user-email');
    const logoutBtn = document.getElementById('logout-btn');

    // Cachés locales
    let unitsCache = [];
    let equipmentCache = [];
    let suppliesCache = [];
    let logoBase64 = null;

    // Variables de estado de UI
    let currentModal = null;
    let signaturePad = null;
    let isInitialized = false;

    // ===================================================================
    // 2. INICIALIZACIÓN DE LA APP
    // ===================================================================

    async function initializeApp() {
        if (isInitialized) return;
        isInitialized = true;

        // Verificar sesión y obtener ROL desde la base de datos
        const session = await Auth.checkAuth();
        
        if (session && session.user) {
        // Obtener rol del usuario de manera robusta
        let userRole = null;
        try {
            // Utilizar rol de la sesión si existe (Auth.checkAuth lo incluye en session.role)
            userRole = session.role || session.user.role || sessionStorage.getItem('role');
        } catch (err) {
            userRole = null;
        }
        // Si no se obtuvo rol, consultar la tabla perfiles para obtener campo "rol"
        if (!userRole) {
            try {
                const { data: perfil } = await db.from('perfiles').select('rol').eq('email', session.user.email).single();
                userRole = perfil ? (perfil.rol || perfil.role) : 'auxiliar';
            } catch (error) {
                console.error('Error fetching user role:', error);
                userRole = 'auxiliar';
            }
        }

            // Normalizar el rol: "usuario" pasa a "auxiliar" para una experiencia coherente
            const normalizedRole = (userRole || 'auxiliar').toString().toLowerCase();
            const isAdminOrSuper = normalizedRole === 'admin' || normalizedRole === 'administrador' || normalizedRole === 'superadmin';
            // Si NO es administrador ni superadmin, cargamos la interfaz de registro (vista auxiliar)
            if (!isAdminOrSuper) {
                appMain.classList.remove('hidden');
                userEmailEl.textContent = session.user.email;
                
                const tempLoader = document.createElement('div');
                tempLoader.innerHTML = `<div class="flex justify-center items-center p-10"><div class="loader"></div><p class="ml-4 text-gray-500 font-medium">${UI_TEXT.loadingData}</p></div>`;
                document.getElementById('tab-content-container').appendChild(tempLoader);

                try {
                    await loadCaches();
                    // Carga segura del logo (si app.js ya cargó la config)
                    logoBase64 = (window.APP_CONFIG && window.APP_CONFIG.HOSPITAL_LOGO_BASE64) ? window.APP_CONFIG.HOSPITAL_LOGO_BASE64 : null;
                } catch (error) {
                    showToast(UI_TEXT.loadingError, 'error');
                    console.error("Initialization Error:", error);
                    tempLoader.innerHTML = `<p class="text-red-500 text-center bg-red-50 p-4 rounded border border-red-200">${UI_TEXT.loadDataError}<br><small>${error.message}</small></p>`;
                    return;
                }
                
                tempLoader.remove();
                
                setupNavigation();
                WasteModule.init(document.getElementById('tab-content-waste'));
                PickupModule.init(document.getElementById('tab-content-pickup'));
                SupplyModule.init(document.getElementById('tab-content-supplies'));
                EquipmentModule.init(document.getElementById('tab-content-equipment'));

            } else {
                // Si es administrador o superadministrador, redirigir al dashboard principal
                window.location.href = 'index.html';
            }
        }
    }

    async function loadCaches() {
        try {
            const [unitsRes, equipmentRes, suppliesRes] = await Promise.all([
                fetchAll(db.from('units').select('id, name').order('name')),
                fetchAll(db.from('equipment').select('id, name, serial_number, status').order('name')),
                fetchAll(db.from('supplies').select('id, item_name').order('item_name'))
            ]);
            
            unitsCache = unitsRes || [];
            equipmentCache = equipmentRes || [];
            suppliesCache = suppliesRes || [];
            
        } catch (error) {
            console.error("Error loading caches:", error);
            throw error;
        }
    }

    // ===================================================================
    // 3. UTILIDADES DE UI Y NAVEGACIÓN
    // ===================================================================

    function setupNavigation() {
        const tabs = document.querySelectorAll('.main-tab-btn');
        const panes = document.querySelectorAll('.tab-pane');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                panes.forEach(p => p.classList.add('hidden'));
                const targetId = `tab-content-${tab.dataset.tab}`;
                const targetPane = document.getElementById(targetId);
                if (targetPane) targetPane.classList.remove('hidden');
                
                const selectedTab = tab.dataset.tab;
                if (selectedTab === 'waste') WasteModule.loadAndRenderRecords();
                if (selectedTab === 'pickup') PickupModule.renderHistory();
                if (selectedTab === 'supplies') SupplyModule.renderHistory();
                if (selectedTab === 'equipment') EquipmentModule.loadAndRenderEquipment();
            });
        });
    }
    
    function showToast(message, type = 'success') {
        const toastId = `toast-${Date.now()}`;
        let toastArea = document.getElementById('toast-area');
        if (!toastArea) {
            toastArea = document.createElement('div');
            toastArea.id = 'toast-area';
            toastArea.className = 'fixed bottom-5 right-5 z-[100] flex flex-col items-end space-y-2';
            document.body.appendChild(toastArea);
        }
        
        const toastContainer = document.createElement('div');
        const bgColor = type === 'error' ? 'bg-red-600' : 'bg-green-600';
        const icon = type === 'error' ? '<i class="fas fa-exclamation-circle mr-2"></i>' : '<i class="fas fa-check-circle mr-2"></i>';
        
        toastContainer.id = toastId;
        toastContainer.className = `${bgColor} text-white py-3 px-4 rounded-lg shadow-lg transition-all duration-300 transform translate-x-full opacity-0 flex items-center`;
        toastContainer.innerHTML = `${icon}<span>${message}</span>`;
        
        toastArea.appendChild(toastContainer);
        
        setTimeout(() => toastContainer.classList.remove('translate-x-full', 'opacity-0'), 10);
        setTimeout(() => {
            toastContainer.classList.add('opacity-0', 'translate-x-full');
            toastContainer.addEventListener('transitionend', () => toastContainer.remove());
        }, 4000);
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
        const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(249, 250, 251)' }); 
        pad.clear();
        return pad;
    }
    
    const createModal = (title, contentHTML, submitText, submitHandler, isHistory = false) => {
        if (currentModal) closeModal();
        const modalContainer = document.getElementById('modal-container');
        
        modalContainer.innerHTML = `
            <div class="fixed inset-0 bg-gray-900 bg-opacity-75 transition-opacity" id="modal-backdrop"></div>
            <div id="dynamic-modal" class="bg-white rounded-lg shadow-xl p-6 w-full max-w-3xl absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 modal-content transform transition-all">
                <div class="flex justify-between items-center border-b pb-3 mb-4">
                    <h2 class="text-2xl font-semibold text-gray-800">${title}</h2>
                    <button type="button" id="close-modal-btn" class="text-gray-400 hover:text-gray-600 text-3xl transition-colors">&times;</button>
                </div>
                <div class="modal-body overflow-y-auto p-1" style="max-height: 70vh;">
                    ${isHistory ? contentHTML : `<form id="modal-form" class="grid grid-cols-1 md:grid-cols-2 gap-4">${contentHTML}</form>`}
                </div>
                <div class="flex justify-end space-x-3 pt-4 border-t mt-4">
                    <button type="button" id="cancel-modal-btn" class="btn btn-secondary">${isHistory ? 'Cerrar' : 'Cancelar'}</button>
                    ${submitText ? `<button type="submit" form="modal-form" class="btn btn-primary">${submitText}</button>` : ''}
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
        
        if (submitHandler) { 
            document.getElementById('modal-form').addEventListener('submit', async (e) => {
                const btn = e.target.querySelector('button[type="submit"]');
                const originalText = submitText;
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = `<div class="loader !w-4 !h-4 !border-2 mr-2"></div> Guardando...`;
                }
                await submitHandler(e);
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            });
        }
    };
    
    const closeModal = () => {
        const modalContainer = document.getElementById('modal-container');
        if (modalContainer) {
            modalContainer.classList.add('hidden');
            modalContainer.innerHTML = '';
        }
        currentModal = null;
        signaturePad = null;
    };
    
    const showConfirmationModal = (title, message, onConfirm) => {
        const modalContainer = document.getElementById('modal-container');
        modalContainer.innerHTML = `
        <div class="confirm-modal-container">
            <div class="confirm-modal-content">
                <div class="confirm-modal-icon text-yellow-500 mb-4 text-4xl text-center"><i class="fas fa-exclamation-triangle"></i></div>
                <h3 class="text-xl font-bold text-center mb-2">${title}</h3>
                <p class="text-gray-600 text-center mb-6">${message}</p>
                <div class="flex justify-center space-x-4">
                    <button type="button" id="confirm-cancel-btn" class="btn btn-secondary">Cancelar</button>
                    <button type="button" id="confirm-accept-btn" class="btn btn-danger">Confirmar</button>
                </div>
            </div>
        </div>`;
        modalContainer.classList.remove('hidden');
        
        document.getElementById('confirm-accept-btn').onclick = () => {
            onConfirm();
            closeModal();
        };
        document.getElementById('confirm-cancel-btn').onclick = closeModal;
    };

    function generateLoanReceiptPDF(loanData) {
        if (!window.jspdf) {
            showToast("Librería de PDF no cargada correctamente.", "error");
            return;
        }
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a5' });
        
        const equipment = equipmentCache.find(e => e.id === loanData.equipment_id) || { name: 'Equipo Eliminado', serial_number: 'N/A' };
        const isLoan = !loanData.return_date;
        const title = isLoan ? 'COMPROBANTE DE PRÉSTAMO' : 'COMPROBANTE DE DEVOLUCIÓN';
        
        if (logoBase64) pdf.addImage(logoBase64, 'PNG', 10, 8, 25, 25);
        pdf.setFontSize(10);
        pdf.setTextColor(100);
        pdf.text('Hospital Penco Lirquén', 40, 15);
        pdf.text('Unidad de Operaciones y Logística', 40, 20);
        
        pdf.setFontSize(14);
        pdf.setTextColor(0);
        pdf.setFont('helvetica', 'bold');
        pdf.text(title, pdf.internal.pageSize.getWidth() / 2, 40, { align: 'center' });
        pdf.setLineWidth(0.5);
        pdf.line(15, 42, 133, 42);

        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'normal');
        let yPos = 55;
        
        const addLine = (label, value) => {
            pdf.setFont('helvetica', 'bold');
            pdf.text(label, 15, yPos);
            pdf.setFont('helvetica', 'normal');
            const splitText = pdf.splitTextToSize(String(value || '-'), 80);
            pdf.text(splitText, 50, yPos);
            yPos += (splitText.length * 6) + 4;
        };

        addLine('Equipo:', equipment.name);
        addLine('N° Serie:', equipment.serial_number);
        addLine('Fecha:', new Date(isLoan ? loanData.date_of_delivery : loanData.return_date).toLocaleString('es-CL'));
        addLine(isLoan ? 'Solicitante:' : 'Devuelto por:', isLoan ? loanData.withdrawing_employee : loanData.returning_employee);
        
        if (isLoan) {
            addLine('Condición:', loanData.delivery_condition || 'No especificada');
            addLine('Obs. Entrega:', loanData.delivery_observations || '-');
        } else {
            addLine('Condición:', loanData.return_condition || 'No especificada');
            addLine('Obs. Devolución:', loanData.return_observations || '-');
        }
        
        yPos += 15;
        const signatureImg = isLoan ? loanData.delivery_signature : loanData.return_signature;
        
        if (signatureImg) {
            try {
                pdf.addImage(signatureImg, 'PNG', 40, yPos, 60, 30);
                yPos += 30;
            } catch (e) {
                pdf.text('[Firma Digital No Disponible]', 40, yPos + 15);
                yPos += 30;
            }
        } else {
            yPos += 30;
        }
        
        pdf.setLineWidth(0.2);
        pdf.line(35, yPos, 113, yPos);
        pdf.setFontSize(9);
        pdf.setTextColor(150);
        pdf.text(isLoan ? 'Firma Recepción Conforme' : 'Firma Devolución', 74, yPos + 5, {align: 'center'});
        
        pdf.setFontSize(8);
        pdf.text(`ID Registro: ${loanData.id}`, 15, 190);
        pdf.text(`Generado: ${new Date().toLocaleString('es-CL')}`, 133, 190, { align: 'right' });

        pdf.save(`comprobante_${isLoan ? 'prestamo' : 'devolucion'}_${loanData.id.substring(0,8)}.pdf`);
    }

    // ===================================================================
    // 4. MÓDULOS DE FUNCIONALIDAD
    // ===================================================================

    /**
     * MÓDULO DE RESIDUOS
     * CORRECCIÓN PRINCIPAL: Usar getters para config y containerOptions
     * Esto evita que el script falle si window.APP_CONFIG no está listo al cargar el archivo.
     */
    const WasteModule = {
        currentTypeId: 'special_waste',
        state: { 
            records: [], 
            filteredRecords: [], 
            sort: { key: 'created_at', asc: false }, 
            filter: '', 
            selected: new Set(), 
            currentPage: 0, 
            recordsPerPage: 1000 
        },
        // [FIX] Getter dinámico para la configuración
        get config() { 
            if (window.APP_CONFIG && window.APP_CONFIG.wasteTypeOptions) {
                return window.APP_CONFIG.wasteTypeOptions;
            }
            // Fallback para evitar crash si config no carga
            return { hazardous_waste: [], special_waste_categories: {} };
        },
        // [FIX] Getter dinámico para opciones de contenedores
        get containerOptions() { 
            const baseConfig = (window.APP_CONFIG && window.APP_CONFIG.containerOptions) ? window.APP_CONFIG.containerOptions : [];
            const baseOptions = baseConfig.map(c => c.name); 
            const bagOptions = ['Bolsa (20L)', 'Bolsa (40L)', 'Bolsa (80L)']; 
            return [...baseOptions, ...bagOptions]; 
        },
        
        init(container) {
            this.container = container;
            this.container.innerHTML = `
                <div class="waste-tabs flex border-b overflow-x-auto">
                    <button type="button" class="waste-tab-btn active whitespace-nowrap px-4 py-2" data-waste-type="special_waste"><i class="fas fa-biohazard mr-2 text-yellow-600"></i>Especiales</button>
                    <button type="button" class="waste-tab-btn whitespace-nowrap px-4 py-2" data-waste-type="hazardous_waste"><i class="fas fa-triangle-exclamation mr-2 text-red-600"></i>Peligrosos</button>
                    <button type="button" class="waste-tab-btn whitespace-nowrap px-4 py-2" data-waste-type="assimilable_waste"><i class="fas fa-recycle mr-2 text-green-600"></i>Asimilables</button>
                </div>
                <div id="waste-content-area" class="mt-6"></div>`;
            
            this.container.querySelector('.waste-tabs').addEventListener('click', (e) => {
                const btn = e.target.closest('.waste-tab-btn');
                if(btn) this.switchWasteType(btn.dataset.wasteType);
            });
            
            this.switchWasteType('special_waste');
        },
        
        switchWasteType(typeId) {
            if (!typeId) return;
            this.container.querySelectorAll('.waste-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.wasteType === typeId));
            this.currentTypeId = typeId;
            
            const area = this.container.querySelector('#waste-content-area');
            area.innerHTML = `
                <div id="waste-form-container"></div>
                <div class="section-card mt-6">
                    <div id="table-toolbar" class="flex justify-between items-center mb-4 flex-wrap gap-4"></div>
                    <div id="waste-table-wrapper">
                        <div class="flex justify-center p-8"><div class="loader"></div></div>
                    </div>
                    <div id="pagination-container" class="flex justify-between items-center mt-4"></div>
                </div>`;
            
            this.renderForm();
            this.loadAndRenderRecords();
        },
        
        renderForm() {
            const formContainer = this.container.querySelector('#waste-form-container');
            const tableName = this.currentTypeId;
            const hasCategory = tableName !== 'assimilable_waste';
            // Accedemos mediante 'this.config' (getter)
            const categorySource = tableName === 'hazardous_waste' ? this.config.hazardous_waste : Object.keys(this.config.special_waste_categories);
            
            const formFields = `
                <div class="form-group">
                    <label>Unidad Generadora</label>
                    <select name="unit_id" class="form-input" required>
                        ${unitsCache.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Fecha de Retiro</label>
                    <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}" class="form-input" required>
                </div>
                ${hasCategory ? `
                <div class="form-group">
                    <label>Tipo de Residuo</label>
                    <select name="waste_type" class="form-input" required>
                        ${categorySource.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Tipo de Contenedor</label>
                    <select name="container_type" class="form-input" required>
                        ${this.containerOptions.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Cantidad (Bultos)</label>
                    <input type="number" name="quantity" value="1" min="1" class="form-input" required>
                </div>` : ''}
                <div class="form-group">
                    <label>Peso Total (kg)</label>
                    <input type="number" step="any" name="weight_kg" placeholder="0.00" class="form-input" required>
                </div>
                <div class="form-group md:col-span-full">
                    <label>Observaciones (Opcional)</label>
                    <textarea name="observations" class="form-input" rows="2" placeholder="Detalles adicionales..."></textarea>
                </div>`;
                
            formContainer.innerHTML = `
                <details class="section-card" open>
                    <summary class="font-bold text-lg cursor-pointer flex items-center gap-2 select-none">
                        <i class="fas fa-plus-circle text-indigo-600"></i> Registrar Nuevo Retiro
                    </summary>
                    <form id="waste-form" class="waste-form-grid mt-4">
                        ${formFields}
                        <div class="form-submit-area mt-4">
                            <button type="submit" class="btn btn-primary w-full md:w-auto">
                                <i class="fas fa-save mr-2"></i> Guardar Registro
                            </button>
                        </div>
                    </form>
                </details>`;
                
            formContainer.querySelector('#waste-form').addEventListener('submit', (e) => this.handleFormSubmit(e));
        },
        
        async loadAndRenderRecords() {
            this.state.records = [];
            this.state.filteredRecords = [];
            this.state.selected = new Set();
            this.state.currentPage = 0;
            
            try {
                const data = await fetchAll(db.from(this.currentTypeId).select('*').order('created_at', { ascending: false }));
                this.state.records = data || [];
                this.processAndRenderTable();
            } catch (error) {
                document.getElementById('waste-table-wrapper').innerHTML = `<p class="text-red-500 text-center p-4">Error al cargar registros: ${error.message}</p>`;
            }
        },
        
        processAndRenderTable() {
            const { records, filter, sort, currentPage, recordsPerPage } = this.state;
            let filtered = [...records];
            
            if (filter) {
                const lowerFilter = filter.toLowerCase();
                filtered = filtered.filter(rec => {
                    const unitName = (unitsCache.find(u => u.id === rec.unit_id) || {}).name || '';
                    return Object.values(rec).some(val => String(val).toLowerCase().includes(lowerFilter)) || 
                           unitName.toLowerCase().includes(lowerFilter);
                });
            }
            
            filtered.sort((a, b) => {
                const valA = a[sort.key] || '';
                const valB = b[sort.key] || '';
                
                if (sort.key === 'unit_id') {
                    const nameA = (unitsCache.find(u => u.id === valA) || {}).name || '';
                    const nameB = (unitsCache.find(u => u.id === valB) || {}).name || '';
                    return nameA.localeCompare(nameB) * (sort.asc ? 1 : -1);
                }
                if (valA < valB) return sort.asc ? -1 : 1;
                if (valA > valB) return sort.asc ? 1 : -1;
                return 0;
            });
            
            this.state.filteredRecords = filtered;
            const paginatedRecords = filtered.slice(currentPage * recordsPerPage, (currentPage + 1) * recordsPerPage);
            
            this.renderTable(paginatedRecords);
            this.renderPagination();
        },
        
        renderTable(recordsToRender) {
            const tableWrapper = document.getElementById('waste-table-wrapper');
            const toolbar = document.getElementById('table-toolbar');
            if (!tableWrapper || !toolbar) return;
            
            toolbar.innerHTML = `
                <div class="search-container relative flex-grow max-w-md">
                    <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                    <input type="text" id="table-filter-input" class="form-input pl-10 w-full" placeholder="Buscar en ${this.state.records.length} registros..." value="${this.state.filter}">
                </div>
                <button type="button" id="delete-selected-btn" class="btn btn-danger btn-sm" disabled>
                    <i class="fas fa-trash-alt mr-1"></i> Eliminar Seleccionados
                </button>`;
                
            const hasCategory = this.currentTypeId !== 'assimilable_waste';
            const headers = [
                { key: 'date', label: 'Fecha' }, 
                { key: 'unit_id', label: 'Unidad' }, 
                ...(hasCategory ? [{ key: 'waste_type', label: 'Categoría' }, { key: 'container_type', label: 'Contenedor' }] : []), 
                { key: 'weight_kg', label: 'Peso (kg)' }, 
                { key: 'observations', label: 'Obs.' }
            ];
            
            const allVisibleSelected = recordsToRender.length > 0 && recordsToRender.every(r => this.state.selected.has(r.id));
            
            tableWrapper.innerHTML = `
                <div class="overflow-x-auto max-h-[600px] border rounded-lg">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th class="p-3 w-10 text-center"><input type="checkbox" id="select-all-checkbox" ${allVisibleSelected ? 'checked' : ''}></th>
                                ${headers.map(h => `<th class="p-3 text-left font-semibold text-gray-600 cursor-pointer hover:bg-gray-100" data-sort-key="${h.key}">${h.label} <i class="fas ${this.state.sort.key === h.key ? (this.state.sort.asc ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort text-gray-300'} ml-1"></i></th>`).join('')}
                                <th class="p-3 text-center font-semibold text-gray-600">Acción</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200 bg-white">
                            ${recordsToRender.length > 0 ? recordsToRender.map(rec => `
                                <tr class="hover:bg-gray-50 transition-colors ${this.state.selected.has(rec.id) ? 'bg-blue-50' : ''}">
                                    <td class="p-3 text-center"><input type="checkbox" class="row-checkbox cursor-pointer" data-id="${rec.id}" ${this.state.selected.has(rec.id) ? 'checked' : ''}></td>
                                    <td class="p-3 whitespace-nowrap">${new Date(rec.date + 'T00:00:00').toLocaleDateString('es-CL')}</td>
                                    <td class="p-3 font-medium text-gray-900">${(unitsCache.find(u => u.id === rec.unit_id) || {}).name || 'N/A'}</td>
                                    ${hasCategory ? `<td class="p-3">${rec.waste_type}</td><td class="p-3 text-gray-500">${rec.container_type}</td>` : ''}
                                    <td class="p-3 text-right font-mono font-bold text-indigo-600">${(parseFloat(rec.weight_kg) || 0).toFixed(2)}</td>
                                    <td class="p-3 text-gray-500 truncate max-w-xs" title="${rec.observations || ''}">${rec.observations || '-'}</td>
                                    <td class="p-3 text-center">
                                        <div class="flex justify-center space-x-2">
                                            <button type="button" class="text-blue-500 hover:text-blue-700" data-action="edit" data-id="${rec.id}" title="Editar"><i class="fas fa-pencil-alt"></i></button>
                                            <button type="button" class="text-red-500 hover:text-red-700" data-action="delete" data-id="${rec.id}" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('') : `<tr><td colspan="100%" class="text-center p-8 text-gray-500">No se encontraron registros.</td></tr>`}
                        </tbody>
                    </table>
                </div>`;
                
            this.setupTableEventListeners();
        },
        
        renderPagination() {
            const { currentPage, recordsPerPage, filteredRecords } = this.state;
            const totalPages = Math.ceil(filteredRecords.length / recordsPerPage);
            const container = document.getElementById('pagination-container');
            
            if (!container) return;
            
            if (totalPages <= 1) { 
                container.innerHTML = `<span class="text-xs text-gray-500">Mostrando ${filteredRecords.length} registros</span>`; 
                return; 
            }
            
            const start = filteredRecords.length > 0 ? currentPage * recordsPerPage + 1 : 0;
            const end = Math.min(start + recordsPerPage - 1, filteredRecords.length);
            
            container.innerHTML = `
                <span class="text-sm text-gray-600">Mostrando ${start}-${end} de ${filteredRecords.length}</span>
                <div class="flex items-center gap-2">
                    <button type="button" class="btn btn-secondary btn-sm" id="prev-page-btn" ${currentPage === 0 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
                    <span class="text-sm font-semibold">Pág ${currentPage + 1}/${totalPages}</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="next-page-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
                </div>`;
                
            document.getElementById('prev-page-btn').addEventListener('click', () => { this.state.currentPage--; this.processAndRenderTable(); });
            document.getElementById('next-page-btn').addEventListener('click', () => { this.state.currentPage++; this.processAndRenderTable(); });
        },
        
        setupTableEventListeners() {
            document.getElementById('table-filter-input').addEventListener('input', (e) => { 
                this.state.filter = e.target.value; 
                this.state.currentPage = 0; 
                this.processAndRenderTable(); 
            });
            
            document.querySelectorAll('th[data-sort-key]').forEach(th => th.addEventListener('click', (e) => { 
                const key = e.currentTarget.dataset.sortKey; 
                if (this.state.sort.key === key) this.state.sort.asc = !this.state.sort.asc; 
                else { this.state.sort.key = key; this.state.sort.asc = true; } 
                this.processAndRenderTable(); 
            }));
            
            const updateSelection = () => { 
                const deleteBtn = document.getElementById('delete-selected-btn'); 
                if(!deleteBtn) return; 
                const count = this.state.selected.size; 
                deleteBtn.disabled = count === 0; 
                deleteBtn.innerHTML = `<i class="fas fa-trash-alt mr-1"></i> Eliminar (${count})`; 
            };
            
            document.getElementById('select-all-checkbox').addEventListener('change', (e) => { 
                const visibleRecordIds = this.state.filteredRecords
                    .slice(this.state.currentPage * this.state.recordsPerPage, (this.state.currentPage + 1) * this.state.recordsPerPage)
                    .map(r => r.id); 
                if (e.target.checked) visibleRecordIds.forEach(id => this.state.selected.add(id)); 
                else visibleRecordIds.forEach(id => this.state.selected.delete(id)); 
                this.processAndRenderTable(); 
            });
            
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.addEventListener('change', (e) => { 
                const id = e.target.dataset.id; 
                if (e.target.checked) this.state.selected.add(id); 
                else this.state.selected.delete(id); 
                updateSelection(); 
                e.target.closest('tr').classList.toggle('bg-blue-50', e.target.checked); 
            }));
            
            document.getElementById('delete-selected-btn').addEventListener('click', () => {
                const ids = Array.from(this.state.selected);
                if (ids.length === 0) return;
                showConfirmationModal(UI_TEXT.deleteConfirmTitle, `¿Eliminar ${ids.length} registros permanentemente?`, async () => {
                    const { error } = await db.from(this.currentTypeId).in('id', ids).delete();
                    if (error) showToast(`${UI_TEXT.deleteError}${error.message}`, 'error');
                    else { 
                        showToast(UI_TEXT.deleteSuccess); 
                        this.state.selected.clear();
                        this.loadAndRenderRecords(); 
                    }
                });
            });
            
            document.querySelectorAll('button[data-action]').forEach(btn => btn.addEventListener('click', (e) => { 
                e.stopPropagation(); 
                const action = e.currentTarget.dataset.action; 
                const id = e.currentTarget.dataset.id; 
                if (action === 'delete') this.handleDelete(id); 
                if (action === 'edit') this.openEditModal(id); 
            }));
            
            updateSelection();
        },
        
        async handleFormSubmit(e) {
            e.preventDefault();
            const form = e.target;
            const formData = new FormData(form);
            let record = Object.fromEntries(formData.entries());
            
            const quantity = parseInt(record.quantity) || 1;
            const totalWeight = parseFloat(record.weight_kg) || 0;
            
            const recordsToInsert = Array.from({ length: quantity }, () => ({
                ...record,
                id: generateUUID(), 
                quantity: undefined, 
                weight_kg: (quantity > 1 && totalWeight > 0) ? (totalWeight / quantity).toFixed(3) : totalWeight 
            }));

            const { error } = await db.from(this.currentTypeId).insert(recordsToInsert);
            
            if (error) {
                showToast(`${UI_TEXT.saveError}${error.message}`, 'error');
            } else {
                form.reset();
                form.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];
                if(form.querySelector('input[name="quantity"]')) form.querySelector('input[name="quantity"]').value = 1;
                this.loadAndRenderRecords();
                showToast(UI_TEXT.saveSuccess(recordsToInsert.length));
            }
        },
        
        handleDelete(recordId) {
            if (!recordId) return;
            showConfirmationModal(UI_TEXT.deleteConfirmTitle, UI_TEXT.deleteConfirmText, async () => {
                const { error } = await db.from(this.currentTypeId).eq('id', recordId).delete();
                if (error) showToast(`${UI_TEXT.deleteError}${error.message}`, 'error');
                else {
                    this.loadAndRenderRecords();
                    showToast(UI_TEXT.deleteSuccess);
                }
            });
        },
        
        async openEditModal(recordId) {
            const { data: record, error } = await db.from(this.currentTypeId).select('*').eq('id', recordId).single();
            if (error || !record) return showToast('Error al cargar registro.', 'error');
            
            const tableName = this.currentTypeId;
            const hasCategory = tableName !== 'assimilable_waste';
            const categorySource = tableName === 'hazardous_waste' ? this.config.hazardous_waste : Object.keys(this.config.special_waste_categories);
            
            const formFields = `
                <div class="form-group">
                    <label>Unidad</label>
                    <select name="unit_id" class="form-input" required>
                        ${unitsCache.map(u => `<option value="${u.id}" ${u.id === record.unit_id ? 'selected' : ''}>${u.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Fecha</label>
                    <input type="date" name="date" value="${record.date}" class="form-input" required>
                </div>
                ${hasCategory ? `
                <div class="form-group">
                    <label>Categoría</label>
                    <select name="waste_type" class="form-input" required>
                        ${categorySource.map(opt => `<option value="${opt}" ${opt === record.waste_type ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Contenedor</label>
                    <select name="container_type" class="form-input" required>
                        ${this.containerOptions.map(opt => `<option value="${opt}" ${opt === record.container_type ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
                </div>` : ''}
                <div class="form-group">
                    <label>Peso (kg)</label>
                    <input type="number" step="any" name="weight_kg" value="${record.weight_kg}" class="form-input" required>
                </div>
                <div class="form-group md:col-span-2">
                    <label>Observaciones</label>
                    <textarea name="observations" class="form-input" rows="3">${record.observations || ''}</textarea>
                </div>`;
                
            createModal('Editar Registro', formFields, 'Actualizar Datos', async (ev) => {
                ev.preventDefault();
                const updateData = Object.fromEntries(new FormData(ev.target).entries());
                const { error: updateError } = await db.from(this.currentTypeId).eq('id', recordId).update(updateData);
                
                if (updateError) showToast(`${UI_TEXT.updateError}${updateError.message}`, 'error');
                else {
                    closeModal();
                    this.loadAndRenderRecords();
                    showToast(UI_TEXT.updateSuccess);
                }
            });
        }
    };
    
    /**
     * MÓDULO DE RETIROS DE UNIDADES (PickupModule)
     */
    const PickupModule = {
        init(container) { 
            this.container = container;
            this.render(); 
            
            this.container.querySelector('#pickup-history-container').addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-action]');
                if (btn) {
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    if (action === 'edit-pickup') this.openPickupEditModal(id);
                    if (action === 'delete-pickup') this.handleDeletePickup(id);
                }
            });
            
            this.populateUnitLists();
            this.renderHistory();
            
            this.container.querySelector('#save-pickup-btn').addEventListener('click', () => this.handleSavePickups());
            
            this.container.addEventListener('change', (e) => {
                if (e.target.type === 'checkbox' && e.target.closest('.pickup-unit-item')) {
                    const wrapper = e.target.closest('.pickup-unit-item').querySelector('.observation-input-wrapper');
                    if (wrapper) wrapper.classList.toggle('hidden', !e.target.checked);
                }
            });
        },
        
        render() {
            this.container.innerHTML = `
                <div class="section-card bg-white shadow-sm rounded-lg border border-gray-200 p-6">
                    <h2 class="text-2xl font-bold mb-1 text-gray-800">Registro Rápido de Retiro</h2>
                    <p class="text-gray-500 mb-6">Seleccione las unidades donde realizó retiros.</p>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div class="bg-red-50 p-4 rounded-lg border border-red-100">
                            <h3 class="text-lg font-semibold mb-3 text-red-700 flex items-center gap-2">
                                <i class="fas fa-triangle-exclamation"></i> Residuos Peligrosos
                            </h3>
                            <div id="pickup-list-hazardous" class="space-y-1 max-h-96 overflow-y-auto pr-2"></div>
                        </div>
                        <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-100">
                            <h3 class="text-lg font-semibold mb-3 text-yellow-700 flex items-center gap-2">
                                <i class="fas fa-biohazard"></i> Residuos Especiales
                            </h3>
                            <div id="pickup-list-special" class="space-y-1 max-h-96 overflow-y-auto pr-2"></div>
                        </div>
                    </div>
                    
                    <div class="flex flex-wrap justify-end items-center mt-6 border-t pt-6 gap-4 bg-gray-50 -mx-6 -mb-6 p-4 rounded-b-lg">
                        <div class="flex items-center gap-2">
                            <label for="pickup-time" class="font-semibold text-gray-700">Hora de Retiro:</label>
                            <input type="time" id="pickup-time" value="${new Date().toTimeString().slice(0,5)}" class="form-input w-32">
                        </div>
                        <button type="button" id="save-pickup-btn" class="btn btn-primary px-6 py-2">
                            <i class="fas fa-check-circle mr-2"></i> Confirmar Retiros
                        </button>
                    </div>
                </div>
                
                <div class="section-card mt-6">
                    <h2 class="text-xl font-bold mb-4 text-gray-800">Historial Completo de Retiros</h2>
                    <div id="pickup-history-container">
                        <div class="flex justify-center p-4"><div class="loader"></div></div>
                    </div>
                </div>`;
        },
        
        populateUnitLists() {
            const unitHTML = unitsCache.map(unit => `
                <div class="pickup-unit-item bg-white mb-1 rounded border border-gray-200 shadow-sm">
                    <label class="flex items-center p-3 cursor-pointer hover:bg-gray-50 transition-colors select-none">
                        <input type="checkbox" data-unit-id="${unit.id}" class="form-checkbox h-5 w-5 rounded text-indigo-600 border-gray-300 focus:ring-indigo-500">
                        <span class="ml-3 font-medium text-gray-700">${unit.name}</span>
                    </label>
                    <div class="observation-input-wrapper hidden px-3 pb-3 pt-0 animate-fade-in-down">
                        <input type="text" placeholder="Observación (opcional)..." class="form-input text-sm w-full bg-gray-50" data-obs-for="${unit.id}">
                    </div>
                </div>`).join('');
                
            document.getElementById('pickup-list-hazardous').innerHTML = unitHTML;
            document.getElementById('pickup-list-special').innerHTML = unitHTML;
        },
        
        async renderHistory() {
            const historyContainer = document.getElementById('pickup-history-container');
            historyContainer.innerHTML = '<div class="flex justify-center p-8"><div class="loader"></div></div>';
            
            try {
                const data = await fetchAll(db.from('unit_pickups').select('*').order('created_at', { ascending: false }));
                
                if (!data || data.length === 0) {
                    historyContainer.innerHTML = '<div class="text-gray-500 text-center p-10 bg-gray-50 rounded border border-dashed border-gray-300">No hay retiros registrados.</div>';
                    return;
                }
                
                historyContainer.innerHTML = `
                    <div class="overflow-x-auto max-h-[600px] border rounded-lg">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-50 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th class="p-3 text-left font-semibold text-gray-600">Fecha</th>
                                    <th class="p-3 text-left font-semibold text-gray-600">Hora</th>
                                    <th class="p-3 text-left font-semibold text-gray-600">Unidad</th>
                                    <th class="p-3 text-left font-semibold text-gray-600">Tipo</th>
                                    <th class="p-3 text-left font-semibold text-gray-600">Observaciones</th>
                                    <th class="p-3 text-center font-semibold text-gray-600">Acciones</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200 bg-white">
                                ${data.map(rec => {
                                    const unitName = (unitsCache.find(u => u.id === rec.unit_id) || {}).name || 'Desconocida';
                                    const isHazardous = rec.waste_type === 'Peligrosos';
                                    return `
                                    <tr class="hover:bg-gray-50 transition-colors">
                                        <td class="p-3 text-gray-600 whitespace-nowrap">${new Date(rec.pickup_date + 'T00:00:00').toLocaleDateString('es-CL')}</td>
                                        <td class="p-3 font-mono text-gray-600">${rec.pickup_time.substring(0,5)}</td>
                                        <td class="p-3 font-medium text-gray-900">${unitName}</td>
                                        <td class="p-3">
                                            <span class="px-2 py-1 text-xs font-semibold rounded-full ${isHazardous ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}">
                                                ${rec.waste_type}
                                            </span>
                                        </td>
                                        <td class="p-3 text-gray-500 italic truncate max-w-xs">${rec.observations || '-'}</td>
                                        <td class="p-3 text-center">
                                            <div class="flex justify-center space-x-2">
                                                <button type="button" class="text-gray-400 hover:text-blue-600 transition-colors" data-action="edit-pickup" data-id="${rec.id}" title="Editar">
                                                    <i class="fas fa-pencil-alt"></i>
                                                </button>
                                                <button type="button" class="text-gray-400 hover:text-red-600 transition-colors" data-action="delete-pickup" data-id="${rec.id}" title="Eliminar">
                                                    <i class="fas fa-trash-alt"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>`;
            } catch (error) {
                historyContainer.innerHTML = `<p class="text-red-500 text-center bg-red-50 p-4 rounded">Error al cargar historial: ${error.message}</p>`;
            }
        },
        
        async handleSavePickups() {
            const recordsToInsert = [];
            const timestamp = new Date().toISOString().split('T')[0];
            const time = document.getElementById('pickup-time').value;
            
            const gatherRecords = (listId, wasteType) => {
                document.querySelectorAll(`#${listId} input:checked`).forEach(cb => {
                    const unitId = cb.dataset.unitId;
                    const obsInput = cb.closest('.pickup-unit-item').querySelector(`input[data-obs-for="${unitId}"]`);
                    
                    recordsToInsert.push({
                        id: generateUUID(),
                        unit_id: unitId,
                        waste_type: wasteType,
                        pickup_date: timestamp,
                        pickup_time: time,
                        user_email: userEmailEl.textContent,
                        observations: obsInput ? obsInput.value.trim() || null : null
                    });
                });
            };
            
            gatherRecords('pickup-list-hazardous', 'Peligrosos');
            gatherRecords('pickup-list-special', 'Especiales');
            
            if (recordsToInsert.length === 0) return showToast(UI_TEXT.noSelection, 'error');
            
            const { error } = await db.from('unit_pickups').insert(recordsToInsert);
            
            if (error) {
                showToast(`${UI_TEXT.saveError}${error.message}`, 'error');
            } else { 
                showToast(UI_TEXT.saveSuccess(recordsToInsert.length));
                document.querySelectorAll('.pickup-unit-item input:checked').forEach(cb => {
                    cb.checked = false;
                    cb.closest('.pickup-unit-item').querySelector('.observation-input-wrapper').classList.add('hidden');
                    const obsInput = cb.closest('.pickup-unit-item').querySelector('input[type="text"]');
                    if(obsInput) obsInput.value = '';
                });
                this.renderHistory();
            }
        },
        
        async openPickupEditModal(recordId) {
            const { data: record, error } = await db.from('unit_pickups').select('*').eq('id', recordId).single();
            if (error || !record) return showToast('Error al cargar registro.', 'error');
            
            const unitName = (unitsCache.find(u => u.id === record.unit_id) || {}).name || 'N/A';
            
            const formFields = `
                <div class="md:col-span-2 bg-gray-50 p-3 rounded border">
                    <label class="block text-xs font-bold text-gray-500 uppercase">Unidad</label>
                    <p class="font-bold text-lg text-gray-800">${unitName}</p>
                    <span class="text-xs px-2 py-1 rounded bg-white border mt-1 inline-block">${record.waste_type}</span>
                </div>
                <div>
                    <label>Fecha</label>
                    <input type="date" name="pickup_date" value="${record.pickup_date}" class="form-input" required>
                </div>
                <div>
                    <label>Hora</label>
                    <input type="time" name="pickup_time" value="${record.pickup_time}" class="form-input" required>
                </div>
                <div class="md:col-span-2">
                    <label>Observaciones</label>
                    <textarea name="observations" class="form-input" rows="3">${record.observations || ''}</textarea>
                </div>`;
                
            createModal('Editar Retiro', formFields, 'Guardar Cambios', async (ev) => {
                ev.preventDefault();
                const updateData = Object.fromEntries(new FormData(ev.target).entries());
                const { error: updateError } = await db.from('unit_pickups').eq('id', recordId).update(updateData);
                
                if (updateError) showToast(`${UI_TEXT.updateError}${updateError.message}`, 'error');
                else {
                    closeModal();
                    this.renderHistory();
                    showToast(UI_TEXT.updateSuccess);
                }
            });
        },
        
        handleDeletePickup(recordId) {
            showConfirmationModal(UI_TEXT.deleteConfirmTitle, UI_TEXT.deleteConfirmText, async () => {
                const { error } = await db.from('unit_pickups').eq('id', recordId).delete();
                if (error) showToast(`${UI_TEXT.deleteError}${error.message}`, 'error');
                else {
                    this.renderHistory();
                    showToast(UI_TEXT.deleteSuccess);
                }
            });
        }
    };

    /**
     * MÓDULO DE ENTREGA DE INSUMOS
     */
    const SupplyModule = {
        init(container) {
            this.container = container;
            if (!this.container) return;
            
            this.populateDropdowns();
            this.renderHistory();
            
            const form = document.getElementById('supply-form');
            if(form) form.addEventListener('submit', (e) => this.handleFormSubmit(e));
            
            window.deleteSupplyDeliveryGlobal = (id) => this.deleteSupplyDelivery(id);
        },
        
        populateDropdowns() {
            const unitSelect = document.getElementById('supply-unit-select');
            const itemSelect = document.getElementById('supply-item-select');
            
            if(unitSelect) {
                unitSelect.innerHTML = `<option value="">Seleccione Unidad...</option>` + 
                    unitsCache.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
            }
            
            if(itemSelect) {
                itemSelect.innerHTML = `<option value="">Seleccione Insumo...</option>` + 
                    suppliesCache.map(s => `<option value="${s.id}">${s.item_name}</option>`).join('');
            }
        },
        
        async handleFormSubmit(e) {
            e.preventDefault();
            const unitId = document.getElementById('supply-unit-select').value;
            const supplyId = document.getElementById('supply-item-select').value;
            const quantity = document.getElementById('supply-quantity').value;
            const notes = document.getElementById('supply-notes').value;

            if(!unitId || !supplyId || !quantity) return showToast('Complete los campos obligatorios', 'error');

            const record = {
                id: generateUUID(),
                unit_id: unitId,
                supply_id: supplyId,
                quantity_delivered: parseFloat(quantity),
                notes: notes || null,
                delivery_date: new Date().toISOString().split('T')[0]
            };

            const { error } = await db.from('supply_deliveries').insert([record]);
            
            if (error) {
                showToast(`${UI_TEXT.saveError}${error.message}`, 'error');
            } else {
                document.getElementById('supply-form').reset();
                document.getElementById('supply-quantity').value = 1;
                showToast('Entrega registrada correctamente.');
                this.renderHistory();
            }
        },
        
        async renderHistory() {
            const container = document.getElementById('supply-history-container');
            if(!container) return;
            
            container.innerHTML = '<div class="flex justify-center p-4"><div class="loader"></div></div>';
            
            try {
                const data = await fetchAll(db.from('supply_deliveries').select('*').order('created_at', { ascending: false }));
                
                if (!data || data.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 p-8 border border-dashed rounded bg-gray-50">No hay entregas registradas.</p>';
                    return;
                }

                const rows = data.map(rec => {
                    const unitName = (unitsCache.find(u => u.id === rec.unit_id) || {}).name || 'N/A';
                    const supplyName = (suppliesCache.find(s => s.id === rec.supply_id) || {}).item_name || 'N/A';
                    const date = new Date(rec.delivery_date + 'T00:00:00').toLocaleDateString('es-CL');
                    
                    return `
                        <tr class="border-b hover:bg-gray-50 transition-colors">
                            <td class="p-3 whitespace-nowrap text-gray-600">${date}</td>
                            <td class="p-3 font-semibold text-gray-800">${unitName}</td>
                            <td class="p-3 text-gray-700">${supplyName}</td>
                            <td class="p-3 text-center font-mono font-bold text-indigo-600 bg-indigo-50 rounded-lg mx-2">${rec.quantity_delivered}</td>
                            <td class="p-3 text-gray-500 text-xs italic truncate max-w-xs">${rec.notes || '-'}</td>
                            <td class="p-3 text-center">
                                <button class="text-red-400 hover:text-red-600 transition-colors p-1" onclick="deleteSupplyDeliveryGlobal('${rec.id}')" title="Eliminar">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </td>
                        </tr>`;
                }).join('');

                container.innerHTML = `
                    <div class="overflow-x-auto max-h-[400px] border rounded-lg">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-50 sticky top-0 shadow-sm">
                                <tr>
                                    <th class="p-3 text-left font-semibold text-gray-600">Fecha</th>
                                    <th class="p-3 text-left font-semibold text-gray-600">Unidad</th>
                                    <th class="p-3 text-left font-semibold text-gray-600">Insumo</th>
                                    <th class="p-3 text-center font-semibold text-gray-600">Cant.</th>
                                    <th class="p-3 text-left font-semibold text-gray-600">Notas</th>
                                    <th class="p-3 text-center font-semibold text-gray-600">Acción</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white">${rows}</tbody>
                        </table>
                    </div>`;
            } catch (error) {
                container.innerHTML = `<p class="text-red-500 text-center p-4">Error: ${error.message}</p>`;
            }
        },
        
        deleteSupplyDelivery(id) {
            showConfirmationModal(UI_TEXT.deleteConfirmTitle, UI_TEXT.deleteConfirmText, async () => {
                const { error } = await db.from('supply_deliveries').eq('id', id).delete();
                if (error) showToast(UI_TEXT.deleteError + error.message, 'error');
                else { 
                    showToast(UI_TEXT.deleteSuccess); 
                    this.renderHistory(); 
                }
            });
        }
    };

    /**
     * MÓDULO DE EQUIPOS
     */
    const EquipmentModule = {
        init(container) {
            this.container = container;
            this.searchInput = container.querySelector('#equipment-search-input');
            this.listContainer = container.querySelector('#equipment-list-container');
            
            if (!this.searchInput || !this.listContainer) return;
            
            this.searchInput.addEventListener('input', (e) => this.loadAndRenderEquipment(e.target.value));
            this.listContainer.addEventListener('click', (e) => this.handleCardClick(e));
            
            this.loadAndRenderEquipment();
        },
        
        async loadAndRenderEquipment(searchTerm = '') {
            this.listContainer.innerHTML = '<div class="flex justify-center p-8 col-span-full"><div class="loader"></div></div>';
            
            let filtered = equipmentCache;
            if (searchTerm) { 
                const lower = searchTerm.toLowerCase(); 
                filtered = equipmentCache.filter(eq => eq.name.toLowerCase().includes(lower) || (eq.serial_number && eq.serial_number.toLowerCase().includes(lower))); 
            }
            
            const { data: activeLoans } = await db.from('equipment_loans').select('id, equipment_id, withdrawing_employee, date_of_delivery').is('return_date', null);
            const activeLoansMap = new Map((activeLoans || []).map(loan => [loan.equipment_id, loan]));
            
            if (filtered.length === 0) { 
                this.listContainer.innerHTML = '<div class="text-gray-500 text-center col-span-full p-8 bg-white rounded shadow-sm">No se encontraron equipos coincidentes.</div>'; 
                return; 
            }
            
            this.listContainer.innerHTML = filtered.map(eq => {
                const activeLoan = activeLoansMap.get(eq.id);
                const isInUse = !!activeLoan;
                const status = isInUse ? 'En Préstamo' : eq.status;
                
                let statusClass = 'bg-green-100 text-green-800';
                if (isInUse) statusClass = 'bg-yellow-100 text-yellow-800'; 
                else if (status === 'En Mantenimiento') statusClass = 'bg-blue-100 text-blue-800'; 
                else if (status === 'De Baja') statusClass = 'bg-red-100 text-red-800';
                
                return `
                <div class="section-card flex flex-col justify-between h-full hover:shadow-md transition-shadow">
                    <div>
                        <div class="flex justify-between items-start mb-2">
                            <h3 class="font-bold text-lg text-gray-800">${eq.name}</h3>
                            <span class="px-2 py-1 text-xs font-bold rounded-full uppercase tracking-wide ${statusClass}">${status}</span>
                        </div>
                        <p class="text-sm text-gray-500 mb-3 font-mono bg-gray-50 inline-block px-2 py-1 rounded">S/N: ${eq.serial_number || 'N/A'}</p>
                        
                        ${isInUse ? `
                        <div class="mt-2 text-sm bg-yellow-50 p-3 rounded-md border border-yellow-100">
                            <p class="text-yellow-800"><i class="fas fa-user mr-1"></i> <strong>${activeLoan.withdrawing_employee}</strong></p>
                            <p class="text-yellow-700 text-xs mt-1"><i class="fas fa-clock mr-1"></i> ${new Date(activeLoan.date_of_delivery).toLocaleString('es-CL')}</p>
                        </div>` : ''}
                    </div>
                    
                    <div class="flex gap-2 mt-4 border-t pt-4">
                        <button type="button" class="btn btn-sm btn-primary flex-1" data-action="prestar" data-equipment-id="${eq.id}" ${isInUse || status !== 'Disponible' ? 'disabled' : ''}>
                            <i class="fas fa-hand-holding mr-1"></i> Prestar
                        </button>
                        <button type="button" class="btn btn-sm btn-success flex-1" data-action="devolver" data-equipment-id="${eq.id}" ${activeLoan ? `data-loan-id="${activeLoan.id}"` : ''} ${!isInUse ? 'disabled' : ''}>
                            <i class="fas fa-undo-alt mr-1"></i> Devolver
                        </button>
                        <button type="button" class="btn btn-sm btn-secondary" data-action="historial" data-equipment-id="${eq.id}" title="Ver Historial">
                            <i class="fas fa-history"></i>
                        </button>
                    </div>
                </div>`;
            }).join('');
        },
        
        handleCardClick(e) {
            const button = e.target.closest('button[data-action]');
            if (!button || button.disabled) return;
            const action = button.dataset.action;
            if (action === 'prestar') this.openLoanModal(button.dataset.equipmentId);
            if (action === 'devolver') this.openReturnModal(button.dataset.equipmentId, button.dataset.loanId);
            if (action === 'historial') this.openHistoryModal(button.dataset.equipmentId);
        },
        
        openLoanModal(equipmentId) {
            const equipment = equipmentCache.find(e => e.id == equipmentId);
            if (!equipment) return showToast(UI_TEXT.equipmentNotFound, 'error');
            const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            
            const formHTML = `
                <input type="hidden" name="equipment_id" value="${equipmentId}">
                <div class="bg-blue-50 p-3 rounded md:col-span-2 mb-2">
                    <p class="font-bold text-blue-800"><i class="fas fa-info-circle mr-2"></i>Prestando: ${equipment.name}</p>
                </div>
                <div>
                    <label class="font-medium">Fecha y Hora</label>
                    <input type="datetime-local" name="date_of_delivery" value="${now.toISOString().slice(0,16)}" class="form-input mt-1" required>
                </div>
                <div>
                    <label class="font-medium">Retira (Nombre y Apellido)</label>
                    <input type="text" name="withdrawing_employee" class="form-input mt-1" placeholder="Ej: Juan Pérez" required>
                </div>
                <div class="md:col-span-2">
                    <label class="font-medium">Condición de Entrega</label>
                    <input type="text" name="delivery_condition" class="form-input mt-1" placeholder="Ej: Buen estado, cargador incluido...">
                </div>
                <div class="md:col-span-2">
                    <label class="font-medium">Observaciones</label>
                    <textarea name="delivery_observations" class="form-input mt-1" rows="2"></textarea>
                </div>
                <div class="md:col-span-2">
                    <label class="font-medium mb-1 block">Firma del Solicitante</label>
                    <div class="border-2 border-dashed border-gray-300 rounded bg-gray-50">
                        <canvas class="signature-pad w-full h-32 cursor-crosshair"></canvas>
                    </div>
                    <button type="button" class="text-xs text-red-500 hover:underline mt-1 font-medium clear-signature">
                        <i class="fas fa-eraser mr-1"></i>Borrar Firma
                    </button>
                </div>`;
                
            createModal(`Registrar Préstamo`, formHTML, 'Confirmar Préstamo', (e) => this.handleLoanSubmit(e));
        },
        
        openReturnModal(equipmentId, loanId) {
            const equipment = equipmentCache.find(e => e.id == equipmentId);
            if (!equipment) return showToast(UI_TEXT.equipmentNotFound, 'error');
            const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            
            const formHTML = `
                <input type="hidden" name="loan_id" value="${loanId}">
                <input type="hidden" name="equipment_id" value="${equipmentId}">
                <div class="bg-green-50 p-3 rounded md:col-span-2 mb-2">
                    <p class="font-bold text-green-800"><i class="fas fa-check-circle mr-2"></i>Devolviendo: ${equipment.name}</p>
                </div>
                <div>
                    <label>Fecha Devolución</label>
                    <input type="datetime-local" name="return_date" value="${now.toISOString().slice(0,16)}" class="form-input mt-1" required>
                </div>
                <div>
                    <label>Responsable Devolución</label>
                    <input type="text" name="returning_employee" class="form-input mt-1" placeholder="Quien entrega el equipo..." required>
                </div>
                <div class="md:col-span-2">
                    <label>Estado Final del Equipo</label>
                    <select name="return_condition" class="form-input mt-1">
                        <option value="Disponible">Operativo (Disponible)</option>
                        <option value="En Mantenimiento">Dañado / Requiere Revisión</option>
                        <option value="De Baja">Irreparable (Dar de Baja)</option>
                    </select>
                </div>
                <div class="md:col-span-2">
                    <label class="font-medium">Observaciones</label>
                    <textarea name="return_observations" class="form-input mt-1" rows="2"></textarea>
                </div>
                <div class="md:col-span-2">
                    <label class="font-medium mb-1 block">Firma de Recepción</label>
                    <div class="border-2 border-dashed border-gray-300 rounded bg-gray-50">
                        <canvas class="signature-pad w-full h-32 cursor-crosshair"></canvas>
                    </div>
                    <button type="button" class="text-xs text-red-500 hover:underline mt-1 font-medium clear-signature">
                        <i class="fas fa-eraser mr-1"></i>Borrar Firma
                    </button>
                </div>`;
                
            createModal(`Registrar Devolución`, formHTML, 'Confirmar Devolución', (e) => this.handleReturnSubmit(e));
        },
        
        async openHistoryModal(equipmentId) {
            const equipment = equipmentCache.find(e => e.id == equipmentId);
            createModal(`Historial: ${equipment.name}`, '<div class="flex justify-center p-4"><div class="loader"></div></div>', null, null, true);
            
            const { data: loans } = await db.from('equipment_loans').select('*').eq('equipment_id', equipmentId).order('date_of_delivery', { ascending: false });
            
            const historyHTML = loans && loans.length > 0 ? `
                <div class="space-y-3">
                    ${loans.map(loan => `
                        <div class="p-4 rounded-lg text-sm relative border shadow-sm ${loan.return_date ? 'bg-white border-gray-200' : 'bg-yellow-50 border-yellow-200'}">
                            <div class="absolute top-3 right-3">
                                <button type="button" class="text-gray-400 hover:text-red-500 transition-colors" data-action="delete-loan" data-loan-id="${loan.id}" data-equipment-id="${equipmentId}" title="Borrar Registro">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pr-8">
                                <div>
                                    <p class="text-xs font-bold text-gray-500 uppercase">Retiro</p>
                                    <p class="font-medium text-gray-800">${new Date(loan.date_of_delivery).toLocaleString('es-CL')}</p>
                                    <p class="text-gray-600">Por: ${loan.withdrawing_employee}</p>
                                </div>
                                <div>
                                    <p class="text-xs font-bold text-gray-500 uppercase">Devolución</p>
                                    ${loan.return_date 
                                        ? `<p class="font-medium text-gray-800">${new Date(loan.return_date).toLocaleString('es-CL')}</p><p class="text-gray-600">Por: ${loan.returning_employee}</p>` 
                                        : '<span class="inline-block bg-yellow-200 text-yellow-800 text-xs px-2 py-1 rounded font-bold mt-1">ACTIVO</span>'
                                    }
                                </div>
                            </div>
                            ${loan.return_observations ? `<div class="mt-2 pt-2 border-t border-dashed border-gray-300 text-gray-500 italic text-xs">Obs: ${loan.return_observations}</div>` : ''}
                        </div>`).join('')}
                </div>` : `<div class="text-center text-gray-500 p-8 bg-gray-50 rounded">${UI_TEXT.noHistory}</div>`;
                
            const modalBody = document.querySelector('#modal-container .modal-body');
            modalBody.innerHTML = historyHTML;
            modalBody.addEventListener('click', (e) => { 
                const btn = e.target.closest('button[data-action="delete-loan"]'); 
                if (btn) this.handleDeleteLoan(btn.dataset.loanId, btn.dataset.equipmentId); 
            });
        },
        
        handleDeleteLoan(loanId, equipmentId) {
            showConfirmationModal(UI_TEXT.deleteConfirmTitle, "Esta acción eliminará el registro permanentemente y podría liberar el equipo si estaba en préstamo.", async () => {
                const { error } = await db.from('equipment_loans').eq('id', loanId).delete();
                
                if (error) return showToast(`${UI_TEXT.deleteError}${error.message}`, 'error');
                
                const { data: remaining } = await db.from('equipment_loans').select('id').eq('equipment_id', equipmentId).is('return_date', null);
                
                if (!remaining || remaining.length === 0) {
                    await db.from('equipment').eq('id', equipmentId).update({ status: 'Disponible' });
                }
                
                showToast(UI_TEXT.deleteSuccess); 
                closeModal(); 
                this.loadAndRenderEquipment();
            });
        },
        
        async handleLoanSubmit(e) {
            e.preventDefault(); 
            if (signaturePad && signaturePad.isEmpty()) return showToast(UI_TEXT.signatureRequired, 'error');
            
            const record = Object.fromEntries(new FormData(e.target).entries()); 
            record.delivery_signature = signaturePad ? signaturePad.toDataURL('image/png') : null; 
            record.status = 'Activo'; 
            record.id = generateUUID();
            
            const { error } = await db.from('equipment_loans').insert([record]);
            
            if (error) return showToast(`${UI_TEXT.saveError}${error.message}`, 'error');
            
            await db.from('equipment').eq('id', record.equipment_id).update({ status: 'En Préstamo' });
            
            showToast('Préstamo registrado correctamente.'); 
            closeModal(); 
            this.loadAndRenderEquipment();
            
            showConfirmationModal(UI_TEXT.printPrompt, UI_TEXT.printLoanText, () => generateLoanReceiptPDF(record));
        },
        
        async handleReturnSubmit(e) {
            e.preventDefault(); 
            if (signaturePad && signaturePad.isEmpty()) return showToast(UI_TEXT.signatureRequired, 'error');
            
            const record = Object.fromEntries(new FormData(e.target).entries());
            if (!record.loan_id) return showToast(UI_TEXT.loanIDInvalid, 'error');
            
            const updatePayload = { 
                return_date: record.return_date, 
                returning_employee: record.returning_employee, 
                return_observations: record.return_observations, 
                return_signature: signaturePad ? signaturePad.toDataURL('image/png') : null, 
                status: 'Devuelto', 
                return_condition: record.return_condition 
            };
            
            const { error } = await db.from('equipment_loans').eq('id', record.loan_id).update(updatePayload);
            
            if (error) return showToast(`Error: ${error.message}`, 'error');
            
            await db.from('equipment').eq('id', record.equipment_id).update({ status: record.return_condition });
            
            showToast('Devolución registrada correctamente.'); 
            closeModal(); 
            this.loadAndRenderEquipment();
            
            const { data: fullData } = await db.from('equipment_loans').select('*').eq('id', record.loan_id).single();
            if (fullData) showConfirmationModal(UI_TEXT.printPrompt, UI_TEXT.printReturnText, () => generateLoanReceiptPDF(fullData));
        }
    };

    // ===================================================================
    // 5. PUNTO DE ENTRADA
    // ===================================================================
    logoutBtn.addEventListener('click', () => Auth.signOut());
    
    initializeApp();
});