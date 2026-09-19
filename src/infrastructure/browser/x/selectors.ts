/**
 * X UI contracts used by the browser boundary.
 *
 * These candidates deliberately describe semantic attributes, accessible
 * roles, and documented text. Generated class names and positional selectors
 * are intentionally absent.
 */
export const X_URLS = {
  origin: "https://x.com",
  login: "https://x.com/i/flow/login"
} as const;

export function isXLoginUrl(value: string): boolean {
  return /\/(?:i\/flow\/login|login)(?:\/|$)/u.test(value);
}

export function isXChallengeUrl(value: string): boolean {
  return /\/(?:challenge|account\/access|i\/flow\/verify)(?:\/|$)/u.test(value);
}

export const X_TEXT_KEYS = {
  login: ["log in", "sign in", "entrar", "iniciar sessão"],
  sessionExpired: ["session expired", "sessão expirada"],
  challenge: [
    "security challenge",
    "suspicious login",
    "captcha",
    "desafio de segurança",
    "verificação de segurança",
    "atividade suspeita"
  ],
  notFound: [
    "post not found",
    "status not found",
    "post não encontrado",
    "status não encontrado",
    "this post has been deleted",
    "esta publicação foi excluída"
  ],
  unavailable: [
    "this post is unavailable",
    "post unavailable",
    "esta publicação está indisponível",
    "publicação indisponível"
  ],
  deleted: [
    "post deleted",
    "status deleted",
    "post excluído",
    "publicação excluída",
    "esta publicação foi excluída"
  ],
  reactionRemoved: [
    "repost undone",
    "repost removed",
    "republicação desfeita",
    "republicação removida",
    "unliked",
    "like removed",
    "descurtido",
    "curtida removida"
  ],
  undoRepost: ["undo repost", "desfazer repost", "desfazer republicação"],
  unlike: ["unlike", "descurtir", "remover curtida"],
  deleteAction: ["delete", "excluir", "apagar"],
  confirmDelete: ["delete", "excluir", "apagar"]
} as const;

export const X_SELECTORS = {
  account: {
    handle: [
      '[data-testid="account-handle"]',
      '[data-testid="account-switcher"]',
      '[data-testid="AccountSwitcher_Button"]',
      '[data-testid="SideNav_AccountSwitcher_Button"]',
      '[data-testid="UserName"]',
      '[data-testid="profile-link"]',
      '[data-testid="AppTabBar_Profile_Link"]',
      'a[aria-label="Profile"]',
      "[data-x-handle]",
      "[data-handle]",
      'meta[name="x-account-handle"]',
      'meta[name="twitter:account-handle"]'
    ],
    profileLink: [
      '[data-testid="profile-link"]',
      '[data-testid="AppTabBar_Profile_Link"]',
      'a[aria-label="Profile"]'
    ],
    userId: [
      '[data-testid="account-id"]',
      '[data-testid="user-id"]',
      "[data-x-user-id]",
      "[data-user-id]",
      'meta[name="x-account-id"]',
      'meta[name="x-user-id"]'
    ],
    login: [
      '[data-testid="login"]',
      '[data-testid="login-button"]',
      '[data-testid="login-flow"]',
      '[data-testid="login-screen"]',
      '[data-authenticated="false"]',
      'meta[name="x-authenticated"][content="false"]',
      'a[href="/login"]',
      'button[aria-label="Log in"]'
    ],
    sessionExpired: [
      '[data-session-expired="true"]',
      'meta[name="x-session-expired"][content="true"]'
    ],
    challenge: [
      '[data-testid="security-challenge"]',
      '[data-testid="challenge"]',
      "[data-security-challenge]",
      'meta[name="x-security-challenge"]'
    ]
  },
  post: {
    target: [
      '[data-testid="post"]',
      '[data-testid="tweet"]',
      "[data-post]",
      "[data-x-status]",
      "article[data-post-id]",
      "article[data-status-id]",
      "article[data-tweet-id]",
      "article"
    ],
    idAttributes: [
      "data-x-status-id",
      "data-status-id",
      "data-post-id",
      "data-tweet-id",
      "data-id"
    ],
    authorAttributes: ["data-author-handle", "data-x-author-handle", "data-post-author"],
    author: [
      '[data-testid="post-author"]',
      '[data-testid="tweet-author"]',
      "[data-author-handle]",
      "[data-x-author-handle]"
    ],
    directDelete: [
      '[data-action="delete-post"]',
      '[data-action="delete-status"]',
      '[data-testid="delete-post"]',
      '[data-testid="delete-status"]'
    ],
    menu: [
      '[data-action="open-post-menu"]',
      '[data-action="open-status-menu"]',
      '[data-testid="post-menu"]',
      '[data-testid="tweet-menu"]',
      'button[aria-label="More"]',
      'button[aria-label="Mais"]',
      '[role="button"][aria-label="More"]',
      '[role="button"][aria-label="Mais"]'
    ],
    deleteAction: [
      '[data-action="delete-post"]',
      '[data-action="delete-status"]',
      '[data-testid="delete-post"]',
      '[data-testid="delete-status"]',
      '[data-testid="delete"]',
      '[role="menuitem"][data-action="delete"]'
    ],
    dialog: [
      '[role="dialog"]',
      '[data-testid="confirmation-dialog"]',
      '[data-confirmation="delete"]'
    ],
    confirmDelete: [
      '[data-action="confirm-delete"]',
      '[data-testid="confirm-delete"]',
      '[data-testid="delete-confirm"]',
      'button[aria-label="Delete"]',
      'button[aria-label="Excluir"]',
      '[role="button"][aria-label="Delete"]',
      '[role="button"][aria-label="Excluir"]'
    ],
    deletedState: [
      '[data-post-state="deleted"]',
      '[data-status-state="deleted"]',
      '[data-state="deleted"]',
      '[data-deleted="true"]',
      '[data-testid="post-deleted"]'
    ],
    missingState: [
      '[data-post-state="not-found"]',
      '[data-status-state="not-found"]',
      '[data-post-state="missing"]',
      '[data-status-state="missing"]',
      '[data-state="not-found"]',
      '[data-state="missing"]',
      '[data-testid="post-not-found"]',
      '[data-testid="status-not-found"]'
    ],
    unavailableState: [
      '[data-post-state="unavailable"]',
      '[data-status-state="unavailable"]',
      '[data-state="unavailable"]',
      '[data-unavailable="true"]',
      '[data-testid="post-unavailable"]'
    ]
  },
  repost: {
    target: [
      '[data-testid="post"]',
      '[data-testid="tweet"]',
      "[data-post]",
      "[data-x-status]",
      "article[data-post-id]",
      "article[data-status-id]",
      "article[data-tweet-id]",
      "article"
    ],
    idAttributes: [
      "data-x-status-id",
      "data-status-id",
      "data-post-id",
      "data-tweet-id",
      "data-id"
    ],
    undoAction: [
      '[data-action="undo-repost"]',
      '[data-action="unrepost"]',
      '[data-testid="undo-repost"]',
      '[data-testid="unrepost"]',
      '[data-testid="unretweet"]',
      '[aria-label="Undo repost"]',
      '[aria-label="Desfazer repost"]',
      '[aria-label="Desfazer republicação"]',
      '[role="button"][aria-label="Undo repost"]',
      '[role="button"][aria-label="Desfazer repost"]',
      '[role="button"][aria-label="Desfazer republicação"]'
    ],
    removedState: [
      '[data-repost-state="undone"]',
      '[data-repost-state="removed"]',
      '[data-action-state="undo-repost"]',
      '[data-action-state="undone"]'
    ]
  },
  like: {
    target: [
      '[data-testid="post"]',
      '[data-testid="tweet"]',
      "[data-post]",
      "[data-x-status]",
      "article[data-post-id]",
      "article[data-status-id]",
      "article[data-tweet-id]",
      "article"
    ],
    idAttributes: [
      "data-x-status-id",
      "data-status-id",
      "data-post-id",
      "data-tweet-id",
      "data-id"
    ],
    unlikeAction: [
      '[data-action="unlike"]',
      '[data-action="remove-like"]',
      '[data-testid="unlike"]',
      '[data-testid="remove-like"]',
      '[data-testid="unfavorite"]',
      '[aria-label="Unlike"]',
      '[aria-label="Descurtir"]',
      '[aria-label="Remover curtida"]',
      '[role="button"][aria-label="Unlike"]',
      '[role="button"][aria-label="Descurtir"]',
      '[role="button"][aria-label="Remover curtida"]'
    ],
    removedState: [
      '[data-like-state="unliked"]',
      '[data-like-state="removed"]',
      '[data-action-state="unlike"]',
      '[data-action-state="unliked"]'
    ]
  }
} as const;

export type XSelectorSet = typeof X_SELECTORS;
