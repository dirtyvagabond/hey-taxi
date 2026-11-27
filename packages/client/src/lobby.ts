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
.lb input { font: inherit; font-size: 11px; color: var(--c64-text); background: #1d154d; border: 2px solid var(--c64-bezel);
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
    if (accountChanged && account) this.switchingAccount = false;
    if (this.root) this.render();
  }

  setNotice(notice: string | null): void {
    this.notice = notice;
    if (this.root) this.render();
  }

  open(): void {
    if (!this.root) {
      this.root = el('div.lb', { role: 'dialog', 'aria-label': 'Taxis Lobby' });
      document.body.append(this.root);
    }
    this.confirmDeleteId = null;
    this.render();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.confirmDeleteId = null;
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    if (!this.account || this.switchingAccount) {
      root.replaceChildren(this.renderAccountView());
      const input = root.querySelector<HTMLInputElement>('input[data-role="account-name"]');
      if (input) input.focus();
    } else {
      root.replaceChildren(this.renderServerBrowser());
    }
  }

  private renderAccountView(): HTMLElement {
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
        this.account
          ? (() => {
              const cancel = el('button', { type: 'button' }, 'Cancel');
              cancel.addEventListener('click', () => {
                this.switchingAccount = false;
                this.render();
              });
              return cancel;
            })()
          : null,
      ),
      this.notice ? el('div.notice', {}, this.notice) : null,
      el('div.section-label', {}, 'New or existing pilot name'),
      form,
    ];

    if (this.accounts.length > 0) {
      const list = el('div.acct-list', {});
      for (const a of this.accounts) {
        const active = a.accountId === this.account?.accountId;
        const btn = el(
          active ? 'button.acct-btn.primary' : 'button.acct-btn',
          { type: 'button' },
          a.name,
        );
        btn.addEventListener('click', () => {
          this.switchingAccount = false;
          this.hooks.onSelectAccount(a.accountId);
        });
        list.append(btn);
      }
      children.push(el('div.section-label', {}, 'Or select an existing account'), list);
    }

    return el('div.lb-panel.narrow', {}, ...children);
  }

  private renderServerBrowser(): HTMLElement {
    const acct = this.account!;

    const switchBtn = el('button', { type: 'button' }, 'Switch Account');
    switchBtn.addEventListener('click', () => {
      this.switchingAccount = true;
      this.render();
    });

    const reviewAllBtn = el('button', { type: 'button' }, 'Server Review');
    reviewAllBtn.addEventListener('click', () => this.hooks.onReviewServer(null));

    const header = el(
      'div.lb-head',
      {},
      el('div', {}, el('h1', {}, 'HEY, TAXI!'), el('div.sub', {}, 'Persistent Servers · Select a server to join')),
      el('div.pilot', {}, el('span.pilot-tag', {}, `PILOT: ${acct.name}`), switchBtn, reviewAllBtn),
    );

    const rows = this.servers.map((s) => {
      const statusCell = (() => {
        if (s.status === 'unreadable') return el('span.bad', {}, s.error ?? 'Unreadable');
        if (!s.account || !s.account.joined) return el('span.dim', {}, 'New pilot · $100.00 start');
        if (s.account.destroyed) {
          return el('span.warn', {}, `Taxi destroyed · ${money(s.account.cents)} kept`);
        }
        return el('span.good', {}, `${s.account.levelName ?? 'In world'} · ${money(s.account.cents)}`);
      })();

      const joinBtn = el('button.primary', { type: 'button' }, 'Join');
      if (s.status === 'unreadable') joinBtn.disabled = true;
      joinBtn.addEventListener('click', () => this.hooks.onJoinServer(s));

      const revBtn = el('button', { type: 'button' }, 'Ledger');
      if (s.status === 'unreadable') revBtn.disabled = true;
      revBtn.addEventListener('click', () => this.hooks.onReviewServer(s.serverId));

      const confirming = this.confirmDeleteId === s.serverId;
      const delBtn = el(confirming ? 'button.danger.confirm' : 'button.danger', { type: 'button' }, confirming ? 'Confirm Delete' : 'Delete');
      delBtn.addEventListener('click', () => {
        if (this.confirmDeleteId === s.serverId) {
          this.confirmDeleteId = null;
          this.hooks.onDeleteServer(s.serverId);
        } else {
          this.confirmDeleteId = s.serverId;
          this.render();
        }
      });

      return el(
        'tr',
        {},
        el('td', {}, el('div.srv-name', {}, s.name)),
        el('td.num.dim', {}, clock(s.seconds)),
        el('td.num.dim', {}, String(s.playerCount)),
        el('td', {}, statusCell),
        el('td', {}, el('div.acts', {}, joinBtn, revBtn, delBtn)),
      );
    });

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

    const srvInput = el('input', {
      type: 'text',
      maxlength: '32',
      placeholder: 'New server name (e.g. Midtown Prime)…',
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

    return el(
      'div.lb-panel',
      {},
      header,
      this.notice ? el('div.notice', {}, this.notice) : null,
      tableOrEmpty,
      el('div.create-bar', {}, el('div.section-label', { style: 'margin-top:0' }, 'Create a new persistent server'), createForm),
    );
  }
}
