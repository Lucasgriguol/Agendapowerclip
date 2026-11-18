/* Gestión de Negocio - Firebase Firestore (sin autenticación).
   Versión simplificada: menos campos, fechas automáticas, textos claros.
   Incluye: alta rápida de cliente y producto en venta, borrado de historial con cascada. */
(() => {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const money = n => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(n) || 0);
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const monthISO = () => todayISO().slice(0, 7);
  const dateLabel = s => s ? new Date(`${s}T12:00:00`).toLocaleDateString("es-AR") : "—";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let db, data = { clients: [], products: [], sales: [], payments: [], expenses: [], cash_movements: [], suppliers: [], settings: {} };
  let currentView = "dashboard", toastTimer;
  const collections = ["clients", "products", "sales", "payments", "expenses", "cash_movements", "suppliers"];
  const titles = { dashboard: "Inicio", sales: "Vender", debts: "Fiados", clients: "Clientes", more: "Más opciones", products: "Productos y stock", expenses: "Gastos", cash: "Caja", suppliers: "Proveedores", reports: "Reportes", settings: "Configuración" };
  const toast = msg => { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600); };
  const showModal = html => { $("#modalContent").innerHTML = html; $("#modal").classList.remove("hidden"); };
  const closeModal = () => $("#modal").classList.add("hidden");
  const sum = arr => arr.reduce((a, b) => a + (Number(b) || 0), 0);
  const clientName = cid => data.clients.find(c => c.id === cid)?.name || "Venta sin cliente";
  const productName = pid => data.products.find(p => p.id === pid)?.name || "Producto";
  const paidForSale = sale => data.payments.filter(p => p.saleId === sale.id).reduce((n, p) => n + Number(p.amount || 0), 0);
  const dueForSale = sale => Math.max(0, Number(sale.total || 0) - paidForSale(sale));
  const monthSales = () => data.sales.filter(s => (s.date || "").startsWith(monthISO()));
  const monthExpenses = () => data.expenses.filter(e => (e.date || "").startsWith(monthISO()));
  const monthPaid = () => data.payments.filter(p => (p.date || "").startsWith(monthISO()));
  const totalDebt = () => sum(data.sales.map(dueForSale));
  const setConnection = (ok, msg) => { $("#connectionDot").classList.toggle("online", ok); $("#connectionText").textContent = msg; };
  // ¿El producto controla stock? Compatible con datos viejos: si existe stock numérico o trackStock true
  const tracksStock = p => p.trackStock === true || (p.stock !== undefined && p.stock !== null && p.stock !== "");

  async function loadAll() {
    setConnection(false, "Conectando…");
    try {
      const snapshots = await Promise.all(collections.map(c => db.collection(c).get()));
      collections.forEach((c, i) => data[c] = snapshots[i].docs.map(d => ({ id: d.id, ...d.data() })));
      const setting = data.settings[0] || {};
      $("#businessName").textContent = setting.businessName || "Mi Negocio";
      setConnection(true, "Conectado");
      render();
    } catch (err) { console.error(err); setConnection(false, "Error de conexión"); toast("No pudimos cargar los datos. Revisá la conexión."); }
  }
  async function addDoc(col, obj) { const ref = await db.collection(col).add({ ...obj, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); await loadAll(); return ref.id; }
  async function updateDoc(col, idv, obj) { await db.collection(col).doc(idv).update({ ...obj, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); await loadAll(); }
  async function deleteDoc(col, idv) { if (!confirm("¿Eliminar este registro?")) return; await db.collection(col).doc(idv).delete(); await loadAll(); toast("Eliminado"); }

  // Borra una venta y sus pagos asociados; devuelve stock si corresponde
  async function deleteSale(saleId) {
    const sale = data.sales.find(s => s.id === saleId);
    if (!sale) return;
    if (!confirm(`¿Eliminar esta venta de ${money(sale.total)}? También se borrarán los pagos asociados.`)) return;
    try {
      const pays = data.payments.filter(p => p.saleId === saleId);
      await Promise.all(pays.map(p => db.collection("payments").doc(p.id).delete()));
      if (sale.productId) {
        const p = data.products.find(x => x.id === sale.productId);
        if (p && tracksStock(p)) {
          await db.collection("products").doc(p.id).update({ stock: firebase.firestore.FieldValue.increment(Number(sale.quantity || 1)) });
        }
      }
      await db.collection("sales").doc(saleId).delete();
      await loadAll();
      toast("Venta eliminada");
    } catch (err) { console.error(err); toast("No se pudo eliminar la venta"); }
  }

  // Borra TODOS los documentos de una colección (con doble confirmación)
  async function clearCollection(col) {
    const names = { sales: "ventas", payments: "pagos", expenses: "gastos", cash_movements: "movimientos de caja", clients: "clientes", products: "productos", suppliers: "proveedores" };
    const label = names[col] || col;
    if (!confirm(`¿Borrar TODO el historial de ${label}? Esta acción no se puede deshacer.`)) return;
    if (!confirm(`Confirmá otra vez: se van a eliminar todos los registros de ${label}.`)) return;
    try {
      const snap = await db.collection(col).get();
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 450) {
        const batch = db.batch();
        docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await loadAll();
      toast(`Historial de ${label} borrado`);
    } catch (err) { console.error(err); toast("No se pudo borrar el historial"); }
  }

  // Helpers de formulario simplificados
  const input = (label, name, value = "", type = "text", extra = "", hint = "") => `<div class="form-group"><label>${label}</label><input class="field" name="${name}" type="${type}" value="${esc(value)}" ${extra}>${hint ? `<small class="field-hint">${hint}</small>` : ""}</div>`;
  const select = (label, name, opts, value = "") => `<div class="form-group"><label>${label}</label><select name="${name}" class="field">${opts.map(o => `<option value="${esc(o[0])}" ${String(value) === String(o[0]) ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select></div>`;
  const formStart = (title, desc) => `<h2>${title}</h2><p class="intro">${desc}</p><form id="entityForm">`;
  const formEnd = (cancel = "Cancelar", save = "Guardar") => `<div class="form-actions"><button type="button" class="btn btn-light" data-close>${cancel}</button><button class="btn btn-primary">${save}</button></div></form>`;
  const table = (headers, rows) => `<div class="table-panel"><div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}"><div class="empty"><b>Sin registros todavía</b>Cuando cargues algo, va a aparecer acá.</div></td></tr>`}</tbody></table></div></div>`;
  const actionBtns = (col, item) => `<button class="btn btn-light btn-small" data-edit="${col}" data-id="${item.id}">Editar</button> <button class="btn btn-danger btn-small" data-delete="${col}" data-id="${item.id}">Borrar</button>`;
  const stat = (label, value, note, icon, color = "#4263eb", tint = "#edf1ff") => `<div class="stat-card" style="--accent:${color};--tint:${tint}"><span class="stat-icon">${icon}</span><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;
  const sectionHead = (title, button, label) => `<div class="section-head"><div><h2>${title}</h2></div><button class="btn btn-primary" data-action="${button}">＋ ${label}</button></div>`;
  // Input de fecha compacto: oculto por defecto, con link "cambiar"
  const dateField = (value, name = "date") => `
    <div class="form-group date-compact">
      <input type="hidden" name="${name}" value="${esc(value)}">
      <small class="field-hint">Fecha: <b>${dateLabel(value)}</b> · <a href="#" data-toggle-date>cambiar</a></small>
      <input class="field hidden" type="date" value="${esc(value)}" data-date-real>
    </div>`;

  /* ---------- VISTAS ---------- */
  function dashboard() {
    const sales = monthSales(), expenses = monthExpenses(), paid = monthPaid();
    const revenue = sum(paid.map(p => p.amount)), out = sum(expenses.map(e => e.amount));
    const debt = totalDebt(), stockAlerts = data.products.filter(p => tracksStock(p) && Number(p.stock || 0) <= Number(p.minStock || 0));
    const recent = [...data.sales].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
    $("#dashboard").innerHTML = `
      <div class="grid stats-grid">
        ${stat("Ventas del mes", money(sum(sales.map(s => s.total))), `${sales.length} ventas`, "↗")}
        ${stat("Cobrado este mes", money(revenue), "Pagos recibidos", "↓", "#15966a", "#e8f8f1")}
        ${stat("Fiado pendiente", money(debt), "Falta cobrar", "◷", "#c88719", "#fff6e5")}
        ${stat("Gastos del mes", money(out), `Te quedó: ${money(revenue - out)}`, "↘", "#d94b5b", "#fff0f1")}
      </div>
      <div class="grid two-col">
        <div class="panel"><div class="panel-head"><h2>Últimas ventas</h2><button class="btn btn-soft btn-small" data-view="sales">Ver todas</button></div>
          ${recent.length ? table(["Fecha", "Cliente", "Total", "Estado"], recent.map(s => `<tr><td>${dateLabel(s.date)}</td><td><span class="person">${esc(clientName(s.clientId))}</span></td><td class="amount">${money(s.total)}</td><td><span class="pill ${dueForSale(s) === 0 ? "green" : "amber"}">${dueForSale(s) === 0 ? "Pagada" : "Debe " + money(dueForSale(s))}</span></td></tr>`).join("")) : `<div class="empty"><b>Todavía no hay ventas</b>Registrá la primera para empezar.</div>`}
        </div>
        <div class="grid">
          <div class="panel"><div class="panel-head"><h2>¿Qué querés hacer?</h2></div><div class="quick-actions">
            <button class="quick-action big" data-action="new-sale"><i>＋</i><b>Vender</b><span>Cargar una venta</span></button>
            <button class="quick-action big" data-action="new-payment"><i>$</i><b>Cobrar</b><span>Registrar un pago</span></button>
            <button class="quick-action" data-action="new-client"><i>♙</i><b>Cliente</b><span>Agregar contacto</span></button>
            <button class="quick-action" data-action="new-product"><i>▤</i><b>Producto</b><span>Sumar al catálogo</span></button>
            <button class="quick-action" data-action="new-expense"><i>↘</i><b>Gasto</b><span>Anotar un egreso</span></button>
            <button class="quick-action" data-action="cash-in"><i>▣</i><b>Caja</b><span>Entrada o salida</span></button>
          </div></div>
          <div class="panel"><div class="panel-head"><h2>Stock bajo</h2><span class="pill ${stockAlerts.length ? "amber" : "green"}">${stockAlerts.length}</span></div>
            ${stockAlerts.length ? `<div class="detail-list">${stockAlerts.slice(0, 5).map(p => `<div class="detail-row"><span>${esc(p.name)}</span><b class="warning">${Number(p.stock || 0)} u.</b></div>`).join("")}</div>` : `<div class="empty">Todo en orden.</div>`}
          </div>
        </div>
      </div>`;
  }
  function salesView() {
    const rows = [...data.sales].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(s => `<tr><td>${dateLabel(s.date)}</td><td><span class="person">${esc(clientName(s.clientId))}</span><span class="subline">${esc(s.description || "Venta")}</span></td><td class="amount">${money(s.total)}</td><td>${money(paidForSale(s))}</td><td><span class="pill ${dueForSale(s) ? "amber" : "green"}">${dueForSale(s) ? money(dueForSale(s)) + " pendiente" : "Pagada"}</span></td><td><button class="btn btn-soft btn-small" data-sale-detail="${s.id}">Ver</button> <button class="btn btn-danger btn-small" data-delete-sale="${s.id}">Borrar</button></td></tr>`);
    $("#sales").innerHTML = sectionHead("Ventas", "new-sale", "Nueva venta") + `<div class="toolbar"><input class="field search" id="salesSearch" placeholder="Buscar por cliente o descripción…"><button class="btn btn-danger" data-clear="sales">Borrar historial</button></div><div id="salesTable">${table(["Fecha", "Cliente / detalle", "Total", "Cobrado", "Saldo", ""], rows.join(""))}</div>`;
  }
  function debtsView() {
    const rows = data.sales.filter(s => dueForSale(s) > 0).sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(s => `<tr><td><b>${esc(clientName(s.clientId))}</b><span class="subline">${dateLabel(s.date)} · ${esc(s.description || "Venta")}</span></td><td>${money(s.total)}</td><td>${money(paidForSale(s))}</td><td class="amount negative">${money(dueForSale(s))}</td><td><button class="btn btn-primary btn-small" data-pay-sale="${s.id}">Cobrar</button></td></tr>`);
    $("#debts").innerHTML = `<div class="grid stats-grid">${stat("Fiado total", money(totalDebt()), "Saldo pendiente", "◷", "#c88719", "#fff6e5")}${stat("Clientes que deben", new Set(data.sales.filter(s => dueForSale(s) > 0).map(s => s.clientId).filter(Boolean)).size, "Con algo pendiente", "♙")}${stat("Pagos registrados", data.payments.length, "Cobros hechos", "$", "#15966a", "#e8f8f1")}</div>${sectionHead("Quiénes deben", "new-payment", "Cobrar")}${table(["Cliente / venta", "Total", "Pagado", "Falta", ""], rows.join(""))}`;
  }
  function clientsView() {
    const rows = data.clients.map(c => `<tr><td><b>${esc(c.name)}</b><span class="subline">${esc(c.phone || "")}</span></td><td>${money(sum(data.sales.filter(s => s.clientId === c.id).map(s => s.total)))}</td><td>${money(sum(data.sales.filter(s => s.clientId === c.id).map(dueForSale)))}</td><td>${actionBtns("clients", c)}</td></tr>`);
    $("#clients").innerHTML = sectionHead("Clientes", "new-client", "Nuevo cliente") + `<div class="toolbar"><input class="field search" id="clientSearch" placeholder="Buscar cliente…"><button class="btn btn-danger" data-clear="clients">Borrar historial</button></div><div id="clientsTable">${table(["Cliente", "Compras", "Debe", ""], rows.join(""))}</div>`;
  }
  function productsView() {
    const rows = data.products.map(p => {
      const st = tracksStock(p);
      const low = st && Number(p.stock || 0) <= Number(p.minStock || 0);
      return `<tr><td><b>${esc(p.name)}</b><span class="subline">${esc(p.category || "")}</span></td><td>${money(p.cost)}</td><td class="amount">${money(p.price)}</td><td>${st ? Number(p.stock || 0) : "—"}</td><td>${st ? `<span class="pill ${low ? "amber" : "green"}">${low ? "Reponer" : "Disponible"}</span>` : `<span class="pill">Sin control</span>`}</td><td>${actionBtns("products", p)}</td></tr>`;
    });
    $("#products").innerHTML = sectionHead("Productos", "new-product", "Nuevo producto") + `<div class="toolbar"><input class="field search" id="productSearch" placeholder="Buscar producto…"><button class="btn btn-danger" data-clear="products">Borrar historial</button></div><div id="productsTable">${table(["Producto", "Costo", "Precio", "Stock", "Estado", ""], rows.join(""))}</div>`;
  }
  function expensesView() {
    const rows = [...data.expenses].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(e => `<tr><td>${dateLabel(e.date)}</td><td><b>${esc(e.concept)}</b><span class="subline">${esc(e.category || "General")}</span></td><td>${esc(e.method || "—")}</td><td class="amount negative">${money(e.amount)}</td><td>${actionBtns("expenses", e)}</td></tr>`);
    $("#expenses").innerHTML = sectionHead("Gastos", "new-expense", "Nuevo gasto") + `<div class="toolbar"><button class="btn btn-danger" data-clear="expenses">Borrar historial</button></div>` + table(["Fecha", "Concepto", "Medio", "Importe", ""], rows.join(""));
  }
  function cashView() {
    const rows = [...data.cash_movements].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(m => `<tr><td>${dateLabel(m.date)}</td><td><b>${esc(m.description)}</b><span class="subline">${esc(m.category || "Movimiento")}</span></td><td><span class="pill ${m.type === "in" ? "green" : "red"}">${m.type === "in" ? "Entrada" : "Salida"}</span></td><td class="amount ${m.type === "in" ? "positive" : "negative"}">${money(m.amount)}</td><td>${actionBtns("cash_movements", m)}</td></tr>`);
    const balance = sum(data.cash_movements.map(m => m.type === "in" ? Number(m.amount) : -Number(m.amount))) + sum(data.payments.filter(p => p.method === "Efectivo").map(p => p.amount)) - sum(data.expenses.filter(e => e.method === "Efectivo").map(e => e.amount));
    $("#cash").innerHTML = `<div class="grid stats-grid">${stat("Balance estimado", money(balance), "Caja según registros", "▣")}${stat("Entradas", money(sum(data.cash_movements.filter(m => m.type === "in").map(m => m.amount))), "Ingresos manuales", "↗", "#15966a", "#e8f8f1")}${stat("Salidas", money(sum(data.cash_movements.filter(m => m.type === "out").map(m => m.amount))), "Egresos manuales", "↘", "#d94b5b", "#fff0f1")}</div>${sectionHead("Movimientos de caja", "cash-in", "Nuevo movimiento")}<div class="toolbar"><button class="btn btn-danger" data-clear="cash_movements">Borrar historial</button></div>${table(["Fecha", "Detalle", "Tipo", "Importe", ""], rows.join(""))}<p class="footer-note">Balance estimado: movimientos manuales + pagos en efectivo − gastos en efectivo. No reemplaza un arqueo.</p>`;
  }
  function suppliersView() {
    const rows = data.suppliers.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.phone || "—")}</td><td>${esc(s.email || "—")}</td><td>${actionBtns("suppliers", s)}</td></tr>`);
    $("#suppliers").innerHTML = sectionHead("Proveedores", "new-supplier", "Nuevo proveedor") + `<div class="toolbar"><button class="btn btn-danger" data-clear="suppliers">Borrar historial</button></div>` + table(["Proveedor", "Teléfono", "Email", ""], rows.join(""));
  }
  function reportsView() {
    const totalSales = sum(monthSales().map(s => s.total)), collected = sum(monthPaid().map(p => p.amount)), spent = sum(monthExpenses().map(e => e.amount));
    const gross = data.products.reduce((n, p) => n + Math.max(0, Number(p.price || 0) - Number(p.cost || 0)) * Number(p.stock || 0), 0);
    $("#reports").innerHTML = `<div class="grid stats-grid">${stat("Ventas del mes", money(totalSales), "Total facturado", "↗")}${stat("Cobros del mes", money(collected), "Dinero recibido", "$", "#15966a", "#e8f8f1")}${stat("Gastos del mes", money(spent), "Egresos", "↘", "#d94b5b", "#fff0f1")}${stat("Te quedó", money(collected - spent), "Cobros − gastos", "＝", collected >= spent ? "#15966a" : "#d94b5b", "#f1f3f8")}</div>
      <div class="grid two-col"><div class="panel"><h2>Resumen</h2><div class="detail-list" style="margin-top:15px"><div class="detail-row"><span>Ventas registradas</span><b>${monthSales().length}</b></div><div class="detail-row"><span>Pagos recibidos</span><b>${monthPaid().length}</b></div><div class="detail-row"><span>Clientes</span><b>${data.clients.length}</b></div><div class="detail-row"><span>Productos</span><b>${data.products.length}</b></div><div class="detail-row"><span>Fiado pendiente</span><b class="negative">${money(totalDebt())}</b></div><div class="detail-row"><span>Margen estimado en stock</span><b>${money(gross)}</b></div></div></div><div class="panel"><h2>Sobre la ganancia</h2><p class="muted" style="line-height:1.7;font-size:12px">El resultado compara cobros y gastos. Para utilidad real hay que sumar costo de lo vendido, compras, impuestos y otros costos. Esta versión no lo calcula automáticamente.</p></div></div>`;
  }
  function settingsView() {
    const s = data.settings[0] || {};
    $("#settings").innerHTML = `<div class="panel settings-block"><h2>Datos del negocio</h2><p class="muted small">Personalizá el nombre y los datos que aparecen en el panel.</p><form id="settingsForm" style="margin-top:20px"><div class="form-grid">${input("Nombre del negocio", "businessName", s.businessName || "Mi Negocio")}${input("Teléfono", "phone", s.phone || "")}${input("Dirección", "address", s.address || "")}${input("Moneda", "currency", "ARS")}</div><div class="form-actions"><button class="btn btn-primary">Guardar</button></div></form></div>
      <div class="notice danger-notice" style="margin-top:18px"><b>Importante:</b> Zona en mantenimiento.</div>`;
  }
  function moreView() {
    const tiles = [
      ["products", "▤", "Productos y stock", "Precios y existencias"],
      ["expenses", "↘", "Gastos", "Lo que sale del negocio"],
      ["cash", "▣", "Caja", "Entradas y salidas"],
      ["suppliers", "♧", "Proveedores", "Quienes te venden"],
      ["reports", "▥", "Reportes", "Resumen de números"],
      ["settings", "⚙", "Datos del negocio", "Nombre y datos del local"]
    ];
    $("#more").innerHTML = `<div class="panel more-intro"><h2>Herramientas</h2><p class="muted">Las opciones menos usadas están acá para que el menú principal quede simple.</p></div>
      <div class="more-grid">${tiles.map(t => `<button class="more-tile" data-view="${t[0]}"><span class="more-icon">${t[1]}</span><span><b>${t[2]}</b><small>${t[3]}</small></span><span class="more-arrow">›</span></button>`).join("")}</div>`;
  }
  function render() {
    $("#pageTitle").textContent = titles[currentView] || "Resumen";
    $("#todayLabel").textContent = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("#monthLabel").textContent = new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    $$(".view").forEach(v => v.classList.toggle("hidden", v.id !== currentView));
    $$(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.view === currentView));
    ({ dashboard, sales: salesView, debts: debtsView, clients: clientsView, more: moreView, products: productsView, expenses: expensesView, cash: cashView, suppliers: suppliersView, reports: reportsView, settings: settingsView }[currentView] || dashboard)();
  }
  function navigate(v) { if (!titles[v]) return; currentView = v; $("#sidebar").classList.remove("open"); render(); }

  /* ---------- FORMULARIOS SIMPLIFICADOS ---------- */

  // CLIENTE: solo nombre obligatorio
  function clientForm(item = {}) {
    showModal(formStart(item.id ? "Editar cliente" : "Nuevo cliente", "Solo el nombre es obligatorio.") +
      `<div class="form-grid">${input("Nombre *", "name", item.name || "", "text", "required autofocus")}${input("Teléfono (opcional)", "phone", item.phone || "", "tel")}</div>
       <details class="extra-fields"><summary>Más datos (opcional)</summary><div class="form-grid" style="margin-top:10px">${input("Email", "email", item.email || "", "email")}${input("Dirección", "address", item.address || "")}<div class="form-group full"><label>Notas</label><textarea class="field" name="notes">${esc(item.notes || "")}</textarea></div></div></details>` + formEnd());
    $("#entityForm").onsubmit = async e => { e.preventDefault(); const o = Object.fromEntries(new FormData(e.target)); try { item.id ? await updateDoc("clients", item.id, o) : await addDoc("clients", o); closeModal(); toast("Cliente guardado"); } catch (err) { toast("No se pudo guardar"); console.error(err); } };
  }

  // PRODUCTO: nombre + precio; stock opcional con checkbox
  function productForm(item = {}) {
    const hasStock = tracksStock(item);
    showModal(formStart(item.id ? "Editar producto" : "Nuevo producto", "Nombre y precio alcanzan. El stock es opcional.") +
      `<div class="form-grid">${input("Nombre *", "name", item.name || "", "text", "required autofocus")}${input("Precio de venta *", "price", item.price ?? "", "number", 'min="0" step="0.01" required')}</div>
       <label class="check-row"><input type="checkbox" name="trackStock" ${hasStock ? "checked" : ""}> Llevar control de stock</label>
       <div class="form-grid stock-fields ${hasStock ? "" : "hidden"}">${input("Stock actual", "stock", item.stock ?? 0, "number", 'min="0" step="1"')}${input("Stock mínimo", "minStock", item.minStock ?? 0, "number", 'min="0" step="1"')}</div>
       <details class="extra-fields"><summary>Más datos (opcional)</summary><div class="form-grid" style="margin-top:10px">${input("Costo", "cost", item.cost ?? 0, "number", 'min="0" step="0.01"')}${input("Categoría", "category", item.category || "")}</div></details>` + formEnd());
    const form = $("#entityForm");
    form.querySelector('[name="trackStock"]').onchange = e => form.querySelector(".stock-fields").classList.toggle("hidden", !e.target.checked);
    form.onsubmit = async e => {
      e.preventDefault();
      const o = Object.fromEntries(new FormData(e.target));
      const track = form.querySelector('[name="trackStock"]').checked;
      const payload = {
        name: o.name, price: Number(o.price || 0), cost: Number(o.cost || 0) || 0,
        category: o.category || "", trackStock: track,
        stock: track ? Number(o.stock || 0) : null,
        minStock: track ? Number(o.minStock || 0) : 0
      };
      try { item.id ? await updateDoc("products", item.id, payload) : await addDoc("products", payload); closeModal(); toast("Producto guardado"); } catch (err) { toast("Error al guardar"); }
    };
  }

  // GASTO: concepto + importe; fecha automática, método por defecto Efectivo
  function expenseForm(item = {}) {
    showModal(formStart(item.id ? "Editar gasto" : "Nuevo gasto", "Concepto e importe. La fecha se completa sola.") +
      `<div class="form-grid">${input("Concepto *", "concept", item.concept || "", "text", "required autofocus")}${input("Importe *", "amount", item.amount ?? "", "number", 'min="0" step="0.01" required')}</div>
       ${dateField(item.date || todayISO())}
       ${select("Categoría", "category", [["General", "General"], ["Mercadería", "Mercadería"], ["Servicios", "Servicios"], ["Alquiler", "Alquiler"], ["Sueldos", "Sueldos"], ["Impuestos", "Impuestos"], ["Otro", "Otro"]], item.category || "General")}` + formEnd());
    $("#entityForm").onsubmit = async e => { e.preventDefault(); const o = Object.fromEntries(new FormData(e.target)); o.amount = Number(o.amount); try { item.id ? await updateDoc("expenses", item.id, o) : await addDoc("expenses", { ...o, method: o.method || "Efectivo" }); closeModal(); toast("Gasto guardado"); } catch (err) { toast("Error al guardar"); } };
  }

  // PROVEEDOR: solo nombre
  function supplierForm(item = {}) {
    showModal(formStart(item.id ? "Editar proveedor" : "Nuevo proveedor", "Solo el nombre. El resto es opcional.") +
      `${input("Nombre *", "name", item.name || "", "text", "required autofocus")}
       <details class="extra-fields"><summary>Más datos (opcional)</summary><div class="form-grid" style="margin-top:10px">${input("Teléfono", "phone", item.phone || "", "tel")}${input("Email", "email", item.email || "", "email")}${input("CUIT", "taxId", item.taxId || "")}</div></details>` + formEnd());
    $("#entityForm").onsubmit = async e => { e.preventDefault(); const o = Object.fromEntries(new FormData(e.target)); try { item.id ? await updateDoc("suppliers", item.id, o) : await addDoc("suppliers", o); closeModal(); toast("Proveedor guardado"); } catch (err) { toast("Error al guardar"); } };
  }

  // VENTA: total + cliente (con alta rápida) + producto (con alta rápida) + "¿pagó todo?"
  function saleForm() {
    const clientOpts = () => [["", "Sin cliente"], ...data.clients.map(c => [c.id, c.name])];
    const productOpts = () => [["", "Sin producto"], ...data.products.map(p => [p.id, `${p.name} · ${money(p.price)}`])];
    showModal(formStart("Nueva venta", "Ingresá el total. Si no pagó todo, el resto queda como fiado.") +
      `<div class="form-grid">${input("Total de la venta *", "total", "", "number", 'min="0" step="0.01" required autofocus')}
        <div class="form-group"><label>Cliente</label>
          <div class="inline-add">
            <select name="clientId" class="field" id="saleClientSelect">
              ${clientOpts().map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("")}
            </select>
            <button type="button" class="btn btn-soft" id="addClientQuick" title="Agregar cliente nuevo" aria-label="Agregar cliente nuevo">＋</button>
          </div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-group"><label>Producto (opcional)</label>
          <div class="inline-add">
            <select name="productId" class="field" id="saleProductSelect">
              ${productOpts().map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("")}
            </select>
            <button type="button" class="btn btn-soft" id="addProductQuick" title="Agregar producto nuevo" aria-label="Agregar producto nuevo">＋</button>
          </div>
        </div>
        ${input("Cantidad", "quantity", 1, "number", 'min="1" step="1"')}
      </div>
      <div class="pay-toggle">
        <label class="check-row big"><input type="radio" name="payAll" value="yes" checked> Pagó todo</label>
        <label class="check-row big"><input type="radio" name="payAll" value="no"> Pagó una parte</label>
      </div>
      <div class="form-group hidden" id="partialPayBox">${input("¿Cuánto pagó?", "initialPayment", "", "number", 'min="0" step="0.01"')}</div>
      <input type="hidden" name="method" value="Efectivo">
      ${dateField(todayISO())}` + formEnd("Cancelar", "Guardar venta"));

    const form = $("#entityForm");
    const prod = form.querySelector('[name="productId"]'), total = form.querySelector('[name="total"]');
    const qty = form.querySelector('[name="quantity"]');

    prod.onchange = () => { const p = data.products.find(x => x.id === prod.value); if (p) total.value = p.price; };
    form.querySelectorAll('[name="payAll"]').forEach(r => r.onchange = () => form.querySelector("#partialPayBox").classList.toggle("hidden", form.querySelector('[name="payAll"]:checked').value === "yes"));

    // --- Alta rápida de CLIENTE sin cerrar la venta ---
    form.querySelector("#addClientQuick").onclick = () => {
      showModal(formStart("Cliente nuevo", "Solo el nombre. Después seguís con la venta.") +
        `${input("Nombre *", "name", "", "text", "required autofocus")}
         ${input("Teléfono (opcional)", "phone", "", "tel")}
         <div class="form-actions"><button type="button" class="btn btn-light" id="cancelQuickClient">Volver a la venta</button><button class="btn btn-primary">Agregar cliente</button></div></form>`);
      const quickForm = $("#entityForm");
      quickForm.querySelector("#cancelQuickClient").onclick = () => saleForm();
      quickForm.onsubmit = async ev => {
        ev.preventDefault();
        const o = Object.fromEntries(new FormData(quickForm));
        if (!o.name?.trim()) { toast("Poné un nombre"); return; }
        try {
          const ref = await db.collection("clients").add({ name: o.name.trim(), phone: o.phone || "", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
          await loadAll();
          saleForm();
          const sel = document.querySelector("#saleClientSelect");
          if (sel) sel.value = ref.id;
          toast("Cliente agregado");
        } catch (err) { console.error(err); toast("No se pudo agregar el cliente"); }
      };
    };

    // --- Alta rápida de PRODUCTO sin cerrar la venta ---
    form.querySelector("#addProductQuick").onclick = () => {
      showModal(formStart("Producto nuevo", "Nombre y precio alcanzan. Después seguís con la venta.") +
        `<div class="form-grid">${input("Nombre *", "name", "", "text", "required autofocus")}${input("Precio de venta *", "price", "", "number", 'min="0" step="0.01" required')}</div>
         <label class="check-row"><input type="checkbox" name="trackStock"> Llevar control de stock</label>
         <div class="form-grid stock-fields hidden">${input("Stock actual", "stock", 0, "number", 'min="0" step="1"')}${input("Stock mínimo", "minStock", 0, "number", 'min="0" step="1"')}</div>
         <div class="form-actions"><button type="button" class="btn btn-light" id="cancelQuickProduct">Volver a la venta</button><button class="btn btn-primary">Agregar producto</button></div></form>`);
      const quickForm = $("#entityForm");
      quickForm.querySelector('[name="trackStock"]').onchange = e => quickForm.querySelector(".stock-fields").classList.toggle("hidden", !e.target.checked);
      quickForm.querySelector("#cancelQuickProduct").onclick = () => saleForm();
      quickForm.onsubmit = async ev => {
        ev.preventDefault();
        const o = Object.fromEntries(new FormData(quickForm));
        if (!o.name?.trim()) { toast("Poné un nombre"); return; }
        if (!o.price) { toast("Poné un precio"); return; }
        const track = quickForm.querySelector('[name="trackStock"]').checked;
        const payload = {
          name: o.name.trim(),
          price: Number(o.price || 0),
          cost: 0,
          category: "",
          trackStock: track,
          stock: track ? Number(o.stock || 0) : null,
          minStock: track ? Number(o.minStock || 0) : 0,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
          const ref = await db.collection("products").add(payload);
          await loadAll();
          saleForm();
          const sel = document.querySelector("#saleProductSelect");
          if (sel) { sel.value = ref.id; }
          const totalEl = document.querySelector('#entityForm [name="total"]');
          if (totalEl) totalEl.value = payload.price;
          toast("Producto agregado");
        } catch (err) { console.error(err); toast("No se pudo agregar el producto"); }
      };
    };

    form.onsubmit = async e => {
      e.preventDefault();
      const o = Object.fromEntries(new FormData(form));
      const totalN = Number(o.total || 0), qtyN = Number(o.quantity || 1);
      const paidAll = form.querySelector('[name="payAll"]:checked').value === "yes";
      const initial = paidAll ? totalN : Number(o.initialPayment || 0);
      if (initial > totalN) { toast("El pago no puede superar el total"); return; }
      if (o.productId) { const p = data.products.find(x => x.id === o.productId); if (p && tracksStock(p) && Number(p.stock || 0) < qtyN) { toast("No hay stock suficiente"); return; } }
      try {
        const saleId = await db.collection("sales").add({ clientId: o.clientId || "", date: o.date, description: productName(o.productId) || "Venta", total: totalN, quantity: qtyN, productId: o.productId || "", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        if (initial > 0) await db.collection("payments").add({ saleId: saleId.id, clientId: o.clientId || "", amount: initial, date: o.date, method: o.method || "Efectivo", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        if (o.productId) { const p = data.products.find(x => x.id === o.productId); if (p && tracksStock(p)) await db.collection("products").doc(p.id).update({ stock: firebase.firestore.FieldValue.increment(-qtyN) }); }
        closeModal(); await loadAll(); toast(initial === totalN ? "Venta registrada y pagada" : "Venta registrada. El saldo quedó como fiado.");
      } catch (err) { console.error(err); toast("No se pudo registrar la venta"); }
    };
  }

  // PAGO: deuda + importe; fecha y método automáticos
  function paymentForm(saleId = "") {
    const pending = data.sales.filter(s => dueForSale(s) > 0);
    const opts = pending.map(s => [s.id, `${clientName(s.clientId)} · debe ${money(dueForSale(s))} · ${dateLabel(s.date)}`]);
    if (!opts.length) { toast("No hay deudas pendientes"); return; }
    const sel = saleId || opts[0][0];
    showModal(formStart("Cobrar", "Elegí la deuda e ingresá cuánto pagó.") +
      `<div class="form-grid">${select("Deuda", "saleId", opts, sel)}${input("Importe *", "amount", saleId ? dueForSale(data.sales.find(s => s.id === saleId)) : "", "number", 'min="0.01" step="0.01" required autofocus')}</div>
       ${dateField(todayISO())}
       <input type="hidden" name="method" value="Efectivo">`+ formEnd("Cancelar", "Cobrar"));
    $("#entityForm").onsubmit = async e => {
      e.preventDefault();
      const o = Object.fromEntries(new FormData(e.target)); o.amount = Number(o.amount);
      const sale = data.sales.find(s => s.id === o.saleId);
      if (!sale || o.amount <= 0 || o.amount > dueForSale(sale)) { toast("Revisá el importe: no puede superar lo que debe"); return; }
      try { await addDoc("payments", { ...o, clientId: sale.clientId || "" }); closeModal(); toast("Pago registrado"); } catch (err) { toast("Error al registrar pago"); }
    };
  }

  // CAJA: descripción + importe + botones Entrada/Salida (con feedback visual y blindaje)
  function cashForm(item = {}) {
    const currentType = item.type === "out" ? "out" : "in";
    showModal(formStart(item.id ? "Editar movimiento" : "Movimiento de caja", "¿Entró o salió dinero?") +
      `<div class="form-grid">${input("Descripción *", "description", item.description || "", "text", "required autofocus")}${input("Importe *", "amount", item.amount ?? "", "number", 'min="0.01" step="0.01" required')}</div>
       <div class="type-toggle" id="cashTypeToggle">
         <label class="type-option ${currentType === "in" ? "active" : ""}" data-type="in">
           <input type="radio" name="type" value="in" ${currentType === "in" ? "checked" : ""}> ↙ Entró
         </label>
         <label class="type-option ${currentType === "out" ? "active" : ""}" data-type="out">
           <input type="radio" name="type" value="out" ${currentType === "out" ? "checked" : ""}> ↗ Salió
         </label>
       </div>
       ${dateField(item.date || todayISO())}
       <input type="hidden" name="category" value="${esc(item.category || "Movimiento manual")}">` + formEnd());

    const form = $("#entityForm");
    const toggle = form.querySelector("#cashTypeToggle");

    // Feedback visual al tocar cada opción
    toggle.querySelectorAll(".type-option").forEach(opt => {
      opt.addEventListener("click", () => {
        toggle.querySelectorAll(".type-option").forEach(o => o.classList.remove("active"));
        opt.classList.add("active");
      });
    });

    form.onsubmit = async e => {
      e.preventDefault();
      const o = Object.fromEntries(new FormData(form));
      // Blindaje: si por algún motivo no llegó 'type', lo tomamos del radio marcado
      const checked = form.querySelector('input[name="type"]:checked');
      o.type = checked ? checked.value : "in";
      if (o.type !== "in" && o.type !== "out") o.type = "in";
      o.amount = Number(o.amount);
      if (!o.description?.trim()) { toast("Poné una descripción"); return; }
      if (!(o.amount > 0)) { toast("Poné un importe mayor a 0"); return; }
      try {
        if (item.id) await updateDoc("cash_movements", item.id, o);
        else await addDoc("cash_movements", o);
        closeModal();
        toast(o.type === "in" ? "Entrada guardada" : "Salida guardada");
      } catch (err) { console.error(err); toast("Error al guardar"); }
    };
  }
  function cashEditForm(item) { return cashForm(item); }

  function saleDetail(sid) {
    const s = data.sales.find(x => x.id === sid); if (!s) return;
    const pays = data.payments.filter(p => p.saleId === sid);
    showModal(`<h2>Detalle de venta</h2><p class="intro">${esc(clientName(s.clientId))} · ${dateLabel(s.date)}</p><div class="detail-list"><div class="detail-row"><span>Descripción</span><b>${esc(s.description || "Venta")}</b></div><div class="detail-row"><span>Total</span><b>${money(s.total)}</b></div><div class="detail-row"><span>Pagado</span><b class="positive">${money(paidForSale(s))}</b></div><div class="detail-row"><span>Falta</span><b class="negative">${money(dueForSale(s))}</b></div></div><h3 style="font:700 13px Manrope;margin:22px 0 8px">Pagos</h3>${pays.length ? pays.map(p => `<div class="detail-row"><span>${dateLabel(p.date)} · ${esc(p.method || "")}</span><b>${money(p.amount)}</b></div>`).join("") : `<p class="muted small">Sin pagos registrados.</p>`}<div class="form-actions"><button class="btn btn-light" data-close>Cerrar</button>${dueForSale(s) > 0 ? `<button class="btn btn-primary" data-pay-sale="${s.id}">Cobrar</button>` : ""}<button class="btn btn-danger" data-delete-sale="${s.id}">Borrar venta</button></div>`);
  }
  function editRecord(col, item) {
    if (col === "clients") return clientForm(item);
    if (col === "products") return productForm(item);
    if (col === "expenses") return expenseForm(item);
    if (col === "suppliers") return supplierForm(item);
    if (col === "cash_movements") return cashEditForm(item);
  }
  function filterTable(inputId, tableId) {
    const q = ($(inputId)?.value || "").toLowerCase();
    $(`${tableId} tbody`)?.querySelectorAll("tr").forEach(tr => tr.classList.toggle("hidden", !tr.textContent.toLowerCase().includes(q)));
  }

  document.addEventListener("click", async e => {
    // Fecha compacta: alternar el input real
    const toggleDate = e.target.closest("[data-toggle-date]");
    if (toggleDate) { e.preventDefault(); const box = toggleDate.closest(".date-compact"); const real = box.querySelector("[data-date-real]"); real.classList.toggle("hidden"); if (!real.classList.contains("hidden")) { real.focus(); real.onchange = () => { box.querySelector('input[type="hidden"]').value = real.value; box.querySelector(".field-hint b").textContent = dateLabel(real.value); }; } return; }

    const close = e.target.closest("[data-close]"); if (close) { closeModal(); return; }
    const nav = e.target.closest("[data-view]"); if (nav) { navigate(nav.dataset.view); return; }
    const action = e.target.closest("[data-action]"); if (action) {
      const a = action.dataset.action;
      if (a === "new-sale") saleForm(); if (a === "new-client") clientForm(); if (a === "new-product") productForm(); if (a === "new-expense") expenseForm(); if (a === "new-payment") paymentForm(); if (a === "cash-in") cashForm(); if (a === "new-supplier") supplierForm();
      return;
    }
    // Borrar una venta con sus pagos y stock
    const delSale = e.target.closest("[data-delete-sale]"); if (delSale) { await deleteSale(delSale.dataset.deleteSale); return; }
    // Borrar historial completo de una colección
    const clearBtn = e.target.closest("[data-clear]"); if (clearBtn) { await clearCollection(clearBtn.dataset.clear); return; }
    const pay = e.target.closest("[data-pay-sale]"); if (pay) { paymentForm(pay.dataset.paySale); return; }
    const detail = e.target.closest("[data-sale-detail]"); if (detail) { saleDetail(detail.dataset.saleDetail); return; }
    const edit = e.target.closest("[data-edit]"); if (edit) { const item = data[edit.dataset.edit].find(x => x.id === edit.dataset.id); if (item) editRecord(edit.dataset.edit, item); return; }
    const del = e.target.closest("[data-delete]"); if (del) {
      if (del.dataset.delete === "sales") { await deleteSale(del.dataset.id); }
      else { await deleteDoc(del.dataset.delete, del.dataset.id); }
      return;
    }
  });
  document.addEventListener("input", e => {
    if (e.target.id === "clientSearch") filterTable("#clientSearch", "#clientsTable");
    if (e.target.id === "productSearch") filterTable("#productSearch", "#productsTable");
    if (e.target.id === "salesSearch") filterTable("#salesSearch", "#salesTable");
  });
  document.addEventListener("submit", async e => {
    if (e.target.id === "settingsForm") { e.preventDefault(); const o = Object.fromEntries(new FormData(e.target)); try { const old = data.settings[0]; if (old) await updateDoc("settings", old.id, o); else await addDoc("settings", o); toast("Configuración guardada"); } catch (err) { toast("Error al guardar"); } }
  });
  $("#quickSaleBtn").addEventListener("click", saleForm);
  $("#mobileMenu")?.addEventListener("click", () => $("#sidebar").classList.toggle("open"));

  function init() {
    if (!window.firebaseConfig || window.firebaseConfig.apiKey === "PEGAR_API_KEY" || window.firebaseConfig.projectId === "TU-PROYECTO") {
      setConnection(false, "Falta configurar Firebase"); $("#dashboard").innerHTML = `<div class="panel empty-state"><h3>Bienvenido</h3><p>Completá <b>firebase-config.js</b> con los datos del proyecto Firebase.</p><p class="muted small">Después habilitá Firestore desde Firebase Console y recargá.</p></div>`; return;
    }
    try { firebase.initializeApp(window.firebaseConfig); db = firebase.firestore(); loadAll(); }
    catch (err) { console.error(err); setConnection(false, "Error al iniciar"); toast("No se pudo iniciar Firebase"); }
  }
  init();
})();