// RadialMenu.js
// Lightweight DOM (HTML/CSS) radial menu used for:
//  - tapping/clicking an empty buildable tile -> choose a tower to build
//  - tapping/clicking an existing tower -> upgrade / target / sell
// Pure UI scaffold: it reports the chosen action/tower id to a callback,
// the actual game-logic wiring (Economy/Tower placement) happens where
// this is used. Kept DOM-based (not WebGL) so touch targets can easily
// meet the 44x44px minimum and respect safe-area insets near screen edges.

const RADIUS_PX = 64;

/**
 * @param {HTMLElement} container  positioned ancestor (e.g. #app)
 * @param {{x:number,y:number}} screenPos  anchor point in container-local px
 * @param {Array<{id:string,label:string,icon?:string}>} items
 * @param {(id:string)=>void} onPick
 * @param {()=>void} onCancel
 */
function openRadialMenu(container, screenPos, items, onPick, onCancel) {
  closeRadialMenu(container);

  const root = document.createElement('div');
  root.className = 'radial-menu';
  root.dataset.radialMenu = '1';

  // Keep the whole menu on-screen even near an edge (important on small
  // phones where a tap near the border is common).
  const margin = RADIUS_PX + 60;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const cx = Math.min(Math.max(screenPos.x, margin), cw - margin);
  const cy = Math.min(Math.max(screenPos.y, margin), ch - margin);

  root.style.left = cx + 'px';
  root.style.top = cy + 'px';

  const count = items.length;
  const radius = count > 3 ? RADIUS_PX + 8 : RADIUS_PX;
  items.forEach((item, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const bx = Math.cos(angle) * radius;
    const by = Math.sin(angle) * radius;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'radial-menu-item' + (item.disabled ? ' is-disabled' : '');
    // Positioned with left/top (not transform) so the :active press-scale
    // in CSS can't knock the button back to the menu centre.
    btn.style.left = bx + 'px';
    btn.style.top = by + 'px';
    btn.style.animationDelay = (i * 25) + 'ms';
    btn.title = item.label;
    let html = `<span class="radial-menu-icon">${item.icon || '•'}</span>`;
    if (item.price != null) {
      html += `<span class="radial-menu-price${item.priceBad ? ' bad' : ''}">${item.price}</span>`;
    }
    if (item.name) html += `<span class="radial-menu-name">${item.name}</span>`;
    btn.innerHTML = html;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.disabled && item.blockedMsg) {
        if (item.onBlocked) item.onBlocked(item.blockedMsg);
        return;
      }
      closeRadialMenu(container);
      onPick(item.id);
    });
    root.appendChild(btn);
  });

  const center = document.createElement('div');
  center.className = 'radial-menu-center';
  center.title = 'Zrušiť';
  center.addEventListener('click', (e) => {
    e.stopPropagation();
    closeRadialMenu(container);
    if (onCancel) onCancel();
  });
  root.appendChild(center);

  // Tapping/clicking anywhere outside the menu cancels it.
  const backdrop = document.createElement('div');
  backdrop.className = 'radial-menu-backdrop';
  backdrop.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    closeRadialMenu(container);
    if (onCancel) onCancel();
  });

  container.appendChild(backdrop);
  container.appendChild(root);
}

function closeRadialMenu(container) {
  container.querySelectorAll('[data-radial-menu], .radial-menu-backdrop').forEach((el) => el.remove());
}

export { openRadialMenu, closeRadialMenu };
