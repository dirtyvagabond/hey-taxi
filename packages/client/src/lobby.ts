/**
 * Lobby overlay: Player Account sign-in/switcher and MMORPG-style Server Browser.
 * Styled to match ReviewScreen & WorldOverviewScreen.
 */
import type { Account, ServerSummary } from '@hey-taxi/sim/protocol';
import { clock, el, ensureTheme, money } from './ui/theme';

const STYLE = `
.lb { position: fixed; inset: 0; z-index: 15; background: rgba(5,7,15,0.92); color: var(--c64-text);
  font: 12px/1.6 var(--c64-font); -webkit-font-smoothing: none; overflow: auto;
  display: flex; align-items: center; justify-content: center; padding: 24px 24px 60px; box-sizing: border-box; }
.lb-panel { width: 100%; max-width: 1020px; background: var(--c64-screen); border: 12px solid var(--c64-bezel);
  border-radius: 0; padding: 24px 28px; box-shadow: 0 18px 54px rgba(0,0,0,0.78); }
.lb-panel.narrow { max-width: 600px; }
.lb-head { display: flex; justify-content: space-between; align-items: center; gap: 16px;
  flex-wrap: wrap; margin-bottom: 18px; border-bottom: 2px solid var(--c64-bezel); padding-bottom: 14px; }
.lb h1 { font-size: 20px; color: var(--c64-accent); margin: 0; letter-spacing: 2px; font-weight: normal; }
.lb .sub { color: var(--c64-dim); font-size: 10px; margin-top: 6px; text-transform: uppercase; }
.lb .pilot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.lb .pilot-tag { color: var(--c64-accent); font-size: 10px; padding: 6px 10px; border-radius: 0;
  background: var(--c64-screen-alt); border: 2px solid var(--c64-accent); text-transform: uppercase; }
.lb button { font: inherit; font-size: 11px; color: var(--c64-text); background: var(--c64-screen-alt);
  border: 2px solid var(--c64-bezel); border-radius: 0; padding: 7px 12px; cursor: pointer; text-transform: uppercase; }
.lb button:hover:not(:disabled) { background: var(--c64-bezel); color: var(--c64-screen); border-color: var(--c64-bezel); }
.lb button:disabled { opacity: 0.4; cursor: default; }
.lb button.primary { background: var(--c64-accent); color: var(--c64-screen); border-color: var(--c64-accent); }
.lb button.primary:hover:not(:disabled) { background: var(--c64-text); color: var(--c64-screen); border-color: var(--c64-text); }
.lb button.danger { color: var(--c64-danger-light); border-color: var(--c64-danger); background: var(--c64-screen-alt); }
.lb button.danger:hover:not(:disabled) { background: var(--c64-danger); border-color: var(--c64-danger-light); color: var(--c64-text); }
.lb button.danger.confirm { background: var(--c64-danger); color: var(--c64-text); border-color: var(--c64-danger-light); }
.lb input { font: inherit; font-size: 11px; color: var(--c64-text); background: #261b5c; border: 2px solid var(--c64-bezel);
  border-radius: 0; padding: 8px 12px; flex: 1; min-width: 180px; outline: none; }
.lb input::placeholder { color: var(--c64-dim); opacity: 0.75; }
.lb input:focus { border-color: var(--c64-accent); }
.lb form.row { display: flex; gap: 10px; align-items: center; }
.lb .notice { background: rgba(136,57,50,0.45); border: 2px solid var(--c64-danger-light);
  color: var(--c64-text); padding: 10px 14px; border-radius: 0; margin-bottom: 16px; white-space: pre-wrap; font-size: 11px; }
.lb table { border-collapse: collapse; width: 100%; margin: 8px 0 18px; }
.lb th { text-align: left; color: var(--c64-dim); font-weight: normal; font-size: 10px; text-transform: uppercase;
  letter-spacing: 1px; border-bottom: 2px solid var(--c64-bezel); padding: 8px 10px; }
.lb td { padding: 10px; border-bottom: 1px solid rgba(120,105,196,0.35); vertical-align: middle; font-size: 11px; }
.lb td.num, .lb th.num { text-align: right; }
.lb .srv-name { color: var(--c64-text); font-size: 12px; }
.lb .acts { display: flex; gap: 6px; justify-content: flex-end; }
.lb .good { color: var(--c64-good); } .lb .warn { color: var(--c64-accent); } .lb .bad { color: var(--c64-danger-light); } .lb .dim { color: var(--c64-dim); }
.lb .acct-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.lb .acct-btn { display: flex; align-items: center; gap: 8px; padding: 7px 14px; }
.lb .section-label { color: var(--c64-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin: 18px 0 8px; }
.lb .create-bar { border-top: 2px solid var(--c64-bezel); padding-top: 16px; margin-top: 8px; }
.lb tr.srv-row { cursor: pointer; }
.lb tr.srv-row.selected .srv-name { color: var(--c64-accent); }
.lb .lb-item { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer;
  color: var(--c64-text); text-transform: uppercase; font-size: 11px; }
.lb .lb-item.selected { color: var(--c64-accent); }
.lb .lb-menu-list { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 8px; }
.lb .lb-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 14px; padding-top: 12px; border-top: 2px solid var(--c64-bezel); }
.lb .lb-hint { color: var(--c64-dim); font-size: 9px; text-transform: uppercase; }
@keyframes lb-c64-blink {
  0%, 49% { background: var(--c64-accent); color: var(--c64-screen); }
  50%, 100% { background: transparent; color: var(--c64-accent); }
}
.lb .c64-cursor { display: inline-block; animation: lb-c64-blink 660ms steps(1) infinite; }
`;

export interface LobbyHooks {
  onCreateAccount(name: string): void;
  onSelectAccount(accountId: string): void;
  onCreateServer(name: string): void;
  onDeleteServer(serverId: string): void;
  onJoinServer(server: ServerSummary): void;
  onReviewServer(serverId: string | null): void;
}

export class LobbyScreen {
  private root: HTMLDivElement | null = null;
  private accounts: Account[] = [];
  private account: Account | null = null;
  private servers: ServerSummary[] = [];
  private notice: string | null = null;
  private switchingAccount = false;
  private confirmDeleteId: string | null = null;
  private pendingAccountInput = '';
  private pendingServerInput = '';
  private selectedIndex = 0;
  private itemActions: Array<() => void> = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly hooks: LobbyHooks) {
    ensureTheme();
    if (!document.getElementById('lb-style')) document.head.append(el('style', { id: 'lb-style' }, STYLE));
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  update(accounts: Account[], account: Account | null, servers: ServerSummary[], notice?: string | null): void {
    this.accounts = accounts;
    const accountChanged = this.account?.accountId !== account?.accountId;
    this.account = account;
    this.servers = servers;
    if (notice !== undefined) this.notice = notice;
    if (accountChanged && account) {
      this.switchingAccount = false;
      this.selectedIndex = 0;
    }
    if (this.root) this.render();
  }

  setNotice(notice: string | null): void {
    this.notice = notice;
    if (this.root) this.render();
  }

  open(): void {
    if (!this.root) {
      this.root = el('div.lb', { role: 'dialog', 'aria-label': 'Taxis Lobby', tabindex: '-1' });
      document.body.append(this.root);
    }
    this.confirmDeleteId = null;
    this.selectedIndex = 0;
    this.bindKeys();
    this.render();
    window.focus();
  }

  close(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    this.root?.remove();
    this.root = null;
    this.confirmDeleteId = null;
    this.itemActions = [];
  }

  private bindKeys(): void {
    if (this.keyHandler) return;
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.root) return;
      const active = document.activeElement;
      const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (typing) {
        if (e.code === 'Escape' || e.code === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          active.blur();
          this.root.focus();
          if (e.code === 'ArrowUp' && this.itemActions.length > 0) {
            this.selectedIndex = (this.selectedIndex - 1 + this.itemActions.length) % this.itemActions.length;
            this.render();
          }
        }
        return;
      }
      const n = this.itemActions.length;
      if (!n) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = (this.selectedIndex - 1 + n) % n;
        this.render();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = (this.selectedIndex + 1) % n;
        this.render();
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        this.itemActions[this.selectedIndex]?.();
      }
    };
    window.addEventListener('keydown', this.keyHandler, true);
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    const active = document.activeElement;
    const wasInAccountInput = active instanceof HTMLInputElement && active.dataset.role === 'account-name';
    const wasInServerInput = active instanceof HTMLInputElement && active.dataset.role === 'server-name';
    if (!this.account || this.switchingAccount) {
      root.replaceChildren(this.renderAccountView());
      const input = root.querySelector<HTMLInputElement>('input[data-role="account-name"]');
      if (input && (this.accounts.length === 0 || wasInAccountInput)) {
        input.focus();
      } else {
        if (active instanceof HTMLElement && active !== root) active.blur();
        root.focus();
      }
    } else {
      root.replaceChildren(this.renderServerBrowser());
      const input = root.querySelector<HTMLInputElement>('input[data-role="server-name"]');
      if (input && (this.servers.length === 0 || wasInServerInput)) {
        input.focus();
      } else {
        if (active instanceof HTMLElement && active !== root) active.blur();
        root.focus();
      }
    }
  }

  private cursorText(text: string, selected: boolean): (Node | string)[] {
    if (!selected || !text.length) return [text];
    return [el('span.c64-cursor', {}, text.charAt(0)), text.slice(1)];
  }

  private renderAccountView(): HTMLElement {
    this.itemActions = [];
    const totalItems = this.accounts.length + 1 + (this.account ? 1 : 0);
    if (this.selectedIndex >= totalItems) this.selectedIndex = 0;

    const input = el('input', {
      type: 'text',
      maxlength: '24',
      placeholder: 'Enter your pilot name…',
      'data-role': 'account-name',
      value: this.pendingAccountInput,
    });
    input.addEventListener('input', () => {
      this.pendingAccountInput = input.value;
    });

    const submit = el('button.primary', { type: 'submit' }, 'Continue');
    const form = el('form.row', {}, input, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      this.pendingAccountInput = '';
      this.switchingAccount = false;
      this.hooks.onCreateAccount(name);
    });

    const children: (Node | string | null | false)[] = [
      el(
        'div.lb-head',
        {},
        el('div', {}, el('h1', {}, 'HEY, TAXI!'), el('div.sub', {}, 'Sign in or create a player account')),
      ),
      this.notice ? el('div.notice', {}, this.notice) : null,
    ];

    if (this.accounts.length > 0) {
      const list = el('div.lb-menu-list', {});
      this.accounts.forEach((a, i) => {
        const sel = this.selectedIndex === i;
        const label = a.name.toUpperCase();
        const activate = () => {
          this.switchingAccount = false;
          this.hooks.onSelectAccount(a.accountId);
        };
        this.itemActions.push(activate);
        const item = el(sel ? 'div.lb-item.selected' : 'div.lb-item', {}, ...this.cursorText(label, sel));
        item.addEventListener('mouseenter', () => {
          if (this.selectedIndex !== i) {
            this.selectedIndex = i;
            this.render();
          }
        });
        item.addEventListener('click', activate);
        list.append(item);
      });
      children.push(el('div.section-label', {}, 'Select pilot'), list);
    }

    const newIdx = this.itemActions.length;
    const newSel = this.selectedIndex === newIdx;
    const focusInput = () => {
      this.selectedIndex = newIdx;
      input.focus();
    };
    this.itemActions.push(focusInput);
    const newLabel = el(
      newSel ? 'div.lb-item.selected' : 'div.lb-item',
      { style: 'margin-top: 12px; padding-left: 0;' },
      ...this.cursorText('NEW PILOT NAME', newSel),
    );
    newLabel.addEventListener('mouseenter', () => {
      if (this.selectedIndex !== newIdx) {
        this.selectedIndex = newIdx;
        this.render();
      }
    });
    newLabel.addEventListener('click', focusInput);
    children.push(newLabel, form);

    if (this.account) {
      const cancelIdx = this.itemActions.length;
      const cancelSel = this.selectedIndex === cancelIdx;
      const cancelAction = () => {
        this.switchingAccount = false;
        this.selectedIndex = 0;
        this.render();
      };
      this.itemActions.push(cancelAction);
      const cancelItem = el(
        cancelSel ? 'div.lb-item.selected' : 'div.lb-item',
        { style: 'margin-top: 10px; padding-left: 0;' },
        ...this.cursorText('CANCEL', cancelSel),
      );
      cancelItem.addEventListener('mouseenter', () => {
        if (this.selectedIndex !== cancelIdx) {
          this.selectedIndex = cancelIdx;
          this.render();
        }
      });
      cancelItem.addEventListener('click', cancelAction);
      children.push(cancelItem);
    }

    children.push(
      el('div.lb-foot', {}, el('span.lb-hint', {}, '↑↓ SELECT · ENTER ACTIVATE')),
    );

    return el('div.lb-panel.narrow', {}, ...children);
  }

  private renderServerBrowser(): HTMLElement {
    const acct = this.account!;
    this.itemActions = [];
    const totalItems = this.servers.length + 3;
    if (this.selectedIndex >= totalItems) this.selectedIndex = 0;

    const srvInput = el('input', {
      type: 'text',
      maxlength: '32',
      placeholder: 'New server name (e.g. Midtown Prime)…',
      'data-role': 'server-name',
      value: this.pendingServerInput,
    });
    srvInput.addEventListener('input', () => {
      this.pendingServerInput = srvInput.value;
    });
    const createBtn = el('button', { type: 'submit' }, '+ Create Server');
    const createForm = el('form.row', {}, srvInput, createBtn);
    createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = srvInput.value.trim();
      if (!name) return;
      this.pendingServerInput = '';
      this.hooks.onCreateServer(name);
    });

    const rows = this.servers.map((s, idx) => {
      const sel = this.selectedIndex === idx;
      const joinable = s.status !== 'unreadable';
      const joinAction = () => {
        if (joinable) this.hooks.onJoinServer(s);
      };
      this.itemActions.push(joinAction);

      const statusCell = (() => {
        if (s.status === 'unreadable') return el('span.bad', {}, s.error ?? 'Unreadable');
        if (!s.account || !s.account.joined) return el('span.dim', {}, 'New pilot · $100.00 start');
        if (s.account.destroyed) {
          return el('span.warn', {}, `Taxi destroyed · ${money(s.account.cents)} kept`);
        }
        return el('span.good', {}, `${s.account.levelName ?? 'In world'} · ${money(s.account.cents)}`);
      })();

      const joinBtn = el('button.primary', { type: 'button' }, 'Join');
      if (!joinable) joinBtn.disabled = true;
      joinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        joinAction();
      });

      const revBtn = el('button', { type: 'button' }, 'Ledger');
      if (!joinable) revBtn.disabled = true;
      revBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hooks.onReviewServer(s.serverId);
      });

      const confirming = this.confirmDeleteId === s.serverId;
      const delBtn = el(
        confirming ? 'button.danger.confirm' : 'button.danger',
        { type: 'button' },
        confirming ? 'Confirm Delete' : 'Delete',
      );
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.confirmDeleteId === s.serverId) {
          this.confirmDeleteId = null;
          this.hooks.onDeleteServer(s.serverId);
        } else {
          this.confirmDeleteId = s.serverId;
          this.render();
        }
      });

      const tr = el(
        sel ? 'tr.srv-row.selected' : 'tr.srv-row',
        {},
        el('td', {}, el('div.srv-name', {}, ...this.cursorText(s.name, sel))),
        el('td.num.dim', {}, clock(s.seconds)),
        el('td.num.dim', {}, String(s.playerCount)),
        el('td', {}, statusCell),
        el('td', {}, el('div.acts', {}, joinBtn, revBtn, delBtn)),
      );
      tr.addEventListener('mouseenter', () => {
        if (this.selectedIndex !== idx) {
          this.selectedIndex = idx;
          this.render();
        }
      });
      tr.addEventListener('click', joinAction);
      return tr;
    });

    const createIdx = this.itemActions.length;
    const createSel = this.selectedIndex === createIdx;
    const focusCreate = () => {
      this.selectedIndex = createIdx;
      srvInput.focus();
    };
    this.itemActions.push(focusCreate);

    const reviewIdx = this.itemActions.length;
    const reviewSel = this.selectedIndex === reviewIdx;
    const reviewAction = () => this.hooks.onReviewServer(null);
    this.itemActions.push(reviewAction);

    const switchIdx = this.itemActions.length;
    const switchSel = this.selectedIndex === switchIdx;
    const switchAction = () => {
      this.switchingAccount = true;
      this.selectedIndex = 0;
      this.render();
    };
    this.itemActions.push(switchAction);

    const makeMenuItem = (idx: number, label: string, sel: boolean, onActivate: () => void) => {
      const node = el(sel ? 'div.lb-item.selected' : 'div.lb-item', {}, ...this.cursorText(label, sel));
      node.addEventListener('mouseenter', () => {
        if (this.selectedIndex !== idx) {
          this.selectedIndex = idx;
          this.render();
        }
      });
      node.addEventListener('click', onActivate);
      return node;
    };

    const header = el(
      'div.lb-head',
      {},
      el('div', {}, el('h1', {}, 'HEY, TAXI!'), el('div.sub', {}, 'Persistent Servers · Select a server to join')),
      el('div.pilot', {}, el('span.pilot-tag', {}, `PILOT: ${acct.name}`)),
    );

    const tableOrEmpty =
      rows.length > 0
        ? el(
            'table',
            {},
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                el('th', {}, 'Server'),
                el('th.num', {}, 'World Age'),
                el('th.num', {}, 'Pilots'),
                el('th', {}, 'Your Account'),
                el('th.num', {}, ''),
              ),
            ),
            el('tbody', {}, ...rows),
          )
        : el('p.dim', {}, 'No servers yet. Create one below to start playing.');

    const createLabel = makeMenuItem(createIdx, 'CREATE NEW SERVER', createSel, focusCreate);
    createLabel.style.paddingLeft = '0';

    const footerActions = el(
      'div.lb-foot',
      {},
      el(
        'div',
        { style: 'display:flex; gap:16px; flex-wrap:wrap;' },
        makeMenuItem(reviewIdx, 'SERVER REVIEW', reviewSel, reviewAction),
        makeMenuItem(switchIdx, 'SWITCH ACCOUNT', switchSel, switchAction),
      ),
      el('span.lb-hint', {}, '↑↓ SELECT · ENTER ACTIVATE'),
    );

    return el(
      'div.lb-panel',
      {},
      header,
      this.notice ? el('div.notice', {}, this.notice) : null,
      tableOrEmpty,
      el('div.create-bar', {}, createLabel, createForm),
      footerActions,
    );
  }
}
