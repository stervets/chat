import {ref} from 'vue';
import {on, off} from '@/composables/event-bus';
import {ws} from '@/composables/classes/ws';
import {restoreSession, wsGamesAction, wsGamesSessionGet} from '@/composables/ws-rpc';
import {
  kingCardImage,
  kingRoundLabel,
  type GameSessionPayload,
  type KingCard,
  type KingPublicState,
} from '@/composables/king';

type RoomMessage = {
  id: number;
  roomId: number;
  authorName: string;
  authorNicknameColor: string | null;
  rawText: string;
};

export default {
  async setup() {
    return {
      router: useRouter(),
      route: useRoute(),
      meId: ref(0),
      sessionId: ref(0),
      loading: ref(true),
      error: ref(''),
      session: ref<GameSessionPayload | null>(null),
      state: ref<KingPublicState | null>(null),
      selectedCard: ref<KingCard | null>(null),
      selectedCardKey: ref(''),
      chatOpen: ref(false),
      chatMessages: ref<RoomMessage[]>([]),
      chatInput: ref(''),
      chatSendPending: ref(false),
      gamesSessionHandler: ref<Function | null>(null),
      gamesStateHandler: ref<Function | null>(null),
      chatMessageHandler: ref<Function | null>(null),
    };
  },

  computed: {
    mePlayer(this: any) {
      if (!this.session || !this.meId) return null;
      return this.session.players.find((player: any) => Number(player.userId) === Number(this.meId)) || null;
    },

    mySeat(this: any) {
      return Number(this.mePlayer?.seat ?? -1);
    },

    leftSeat(this: any) {
      if (this.mySeat < 0) return 0;
      return (this.mySeat + 1) % 4;
    },

    topSeat(this: any) {
      if (this.mySeat < 0) return 0;
      return (this.mySeat + 2) % 4;
    },

    rightSeat(this: any) {
      if (this.mySeat < 0) return 0;
      return (this.mySeat + 3) % 4;
    },

    bottomSeat(this: any) {
      return this.mySeat < 0 ? 0 : this.mySeat;
    },

    opponents(this: any) {
      if (!this.session || this.mySeat < 0) return [];
      const seats = [this.leftSeat, this.topSeat, this.rightSeat];
      return seats
        .map((seat) => this.session.players.find((player: any) => Number(player.seat) === Number(seat)))
        .filter(Boolean);
    },

    seatOrder(this: any) {
      if (this.mySeat < 0) return [];
      return [0, 1, 2, 3].map((offset) => ({
        seat: (this.mySeat + offset) % 4,
      }));
    },

    myHand(this: any) {
      if (!this.state || !this.mePlayer) return [];
      const playerState = this.state.players.find((player: any) => Number(player.userId) === Number(this.mePlayer.userId));
      return Array.isArray(playerState?.hand) ? playerState.hand : [];
    },

    isMyTurn(this: any) {
      if (!this.state || this.mySeat < 0) return false;
      return Number(this.state.currentSeat) === Number(this.mySeat);
    },

    actionHint(this: any) {
      if (!this.state) return '';
      if (this.state.phase === 'finished') return 'Матч завершён';
      if (this.isMyTurn) return 'Выбери карту и нажми "Сыграть"';
      return `Сейчас ходит ${this.playerNameBySeat(this.state.currentSeat)}`;
    },

    canPlaySelected(this: any) {
      if (!this.isMyTurn || !this.selectedCard) return false;
      const actions = Array.isArray(this.session?.actions) ? this.session.actions : [];
      return actions.some((action: any) => {
        return action?.type === 'play_card'
          && action?.payload?.suit === this.selectedCard.suit
          && action?.payload?.rank === this.selectedCard.rank;
      });
    },

    roundLabel(this: any) {
      if (!this.state) return '';
      return kingRoundLabel(this.state.roundIndex, this.state.roundKind);
    },

    trumpLabel(this: any) {
      const suit = String(this.state?.trumpSuit || '').trim();
      if (!suit) return 'нет';
      const map: Record<string, string> = {
        clubs: 'трефы',
        diamonds: 'бубны',
        hearts: 'черви',
        spades: 'пики',
      };
      return map[suit] || suit;
    },
  },

  methods: {
    async ensureAuth(this: any) {
      const session = await restoreSession();
      if ((session as any)?.ok && (session as any)?.user?.id) {
        this.meId = Number((session as any).user.id || 0);
        return true;
      }
      await this.router.replace('/login');
      return false;
    },

    parseRouteSessionId(this: any) {
      const raw = Array.isArray(this.route?.params?.id)
        ? this.route.params.id[0]
        : this.route?.params?.id;
      const parsed = Number.parseInt(String(raw || ''), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return parsed;
    },

    normalizeRoomMessage(this: any, raw: any): RoomMessage | null {
      const id = Number(raw?.id || 0);
      const roomId = Number(raw?.roomId || 0);
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(roomId) || roomId <= 0) return null;
      return {
        id,
        roomId,
        authorName: String(raw?.authorName || raw?.authorNickname || 'unknown'),
        authorNicknameColor: raw?.authorNicknameColor ? String(raw.authorNicknameColor) : null,
        rawText: String(raw?.rawText || ''),
      };
    },

    upsertRoomMessage(this: any, raw: any) {
      const next = this.normalizeRoomMessage(raw);
      if (!next) return;
      if (!this.session || Number(next.roomId) !== Number(this.session.roomId)) return;

      const exists = this.chatMessages.some((item: RoomMessage) => item.id === next.id);
      if (exists) return;
      this.chatMessages = [...this.chatMessages, next].slice(-120);
    },

    playerBySeat(this: any, seat: number) {
      return this.session?.players?.find((player: any) => Number(player.seat) === Number(seat)) || null;
    },

    playerNameBySeat(this: any, seat: number) {
      return this.playerBySeat(seat)?.user?.name || `S${Number(seat) + 1}`;
    },

    totalScoreBySeat(this: any, seat: number) {
      const playerState = this.state?.players?.find((player: any) => Number(player.seat) === Number(seat));
      const value = Number(playerState?.totalScore || 0);
      return value >= 0 ? `+${value}` : String(value);
    },

    cardsCountBySeat(this: any, seat: number) {
      const playerState = this.state?.players?.find((player: any) => Number(player.seat) === Number(seat));
      return Number(playerState?.cardsCount || 0);
    },

    trickCardBySeat(this: any, seat: number) {
      if (!this.state?.currentTrick?.plays) return null;
      const play = this.state.currentTrick.plays.find((item: any) => Number(item.seat) === Number(seat));
      return play?.card || null;
    },

    cardBySeat(this: any, seat: number) {
      const card = this.trickCardBySeat(seat);
      if (!card) {
        return '/cards/back.gif';
      }
      return kingCardImage(card);
    },

    cardKey(_this: any, card: KingCard) {
      return `${card.rank}:${card.suit}`;
    },

    selectCard(this: any, card: KingCard) {
      this.selectedCard = card;
      this.selectedCardKey = this.cardKey(card);
    },

    async playSelectedCard(this: any) {
      if (!this.canPlaySelected || !this.selectedCard || !this.sessionId) return;

      this.error = '';
      const action = {
        type: 'play_card',
        payload: {
          suit: this.selectedCard.suit,
          rank: this.selectedCard.rank,
        },
      };

      const result = await wsGamesAction(this.sessionId, action);
      if (!(result as any)?.ok) {
        const code = String((result as any)?.error || 'unknown_error');
        if (code === 'invalid_card') {
          this.error = 'Этой картой нельзя ходить по текущим правилам.';
          return;
        }
        if (code === 'not_your_turn') {
          this.error = 'Сейчас не твой ход.';
          return;
        }
        this.error = `Ход не принят (${code}).`;
        return;
      }

      const payload = (result as any)?.session;
      if (payload) {
        this.applySessionPayload(payload);
      }
      this.selectedCard = null;
      this.selectedCardKey = '';
    },

    async loadRoomMessages(this: any) {
      if (!this.session?.roomId) return;

      const result = await ws.request('message:list', {
        roomId: this.session.roomId,
        limit: 60,
      });
      if (!Array.isArray(result)) return;
      const normalized = result
        .map((item: any) => this.normalizeRoomMessage(item))
        .filter(Boolean);
      this.chatMessages = normalized;
    },

    applySessionPayload(this: any, payloadRaw: any) {
      if (!payloadRaw) return;
      this.session = payloadRaw;
      this.state = payloadRaw.state || null;

      if (this.selectedCard) {
        const stillInHand = this.myHand.some((card: KingCard) => this.cardKey(card) === this.selectedCardKey);
        if (!stillInHand) {
          this.selectedCard = null;
          this.selectedCardKey = '';
        }
      }
    },

    async fetchSession(this: any) {
      this.loading = true;
      this.error = '';

      const result = await wsGamesSessionGet(this.sessionId);
      if (!(result as any)?.ok) {
        this.loading = false;
        const code = String((result as any)?.error || 'unknown_error');
        this.error = `Сессию не открыть (${code}).`;
        return;
      }

      this.applySessionPayload((result as any).session);
      await this.loadRoomMessages();
      this.loading = false;
    },

    onGamesSession(this: any, payload: any) {
      const sessionId = Number(payload?.id || payload?.sessionId || 0);
      if (sessionId !== this.sessionId) return;
      if (!payload?.state) return;
      this.applySessionPayload(payload);
    },

    onGamesState(this: any, payload: any) {
      if (Number(payload?.sessionId || 0) !== this.sessionId) return;
      if (!this.session || !this.state) return;

      this.state = payload.state || this.state;
      this.session = {
        ...this.session,
        status: payload.status || this.session.status,
        state: this.state,
        actions: Array.isArray(payload.actions) ? payload.actions : this.session.actions,
      };
    },

    onChatMessage(this: any, payload: any) {
      this.upsertRoomMessage(payload);
    },

    async sendChat(this: any) {
      if (this.chatSendPending || !this.session?.roomId) return;

      const text = String(this.chatInput || '').trim();
      if (!text) return;

      this.chatSendPending = true;
      try {
        const result = await ws.request('message:create', {
          roomId: this.session.roomId,
          kind: 'text',
          text,
        });
        if ((result as any)?.ok) {
          this.chatInput = '';
        }
      } finally {
        this.chatSendPending = false;
      }
    },

    toggleChat(this: any) {
      this.chatOpen = !this.chatOpen;
    },

    async goToLobby(this: any) {
      await this.router.push('/games');
    },
  },

  async mounted(this: any) {
    const ok = await this.ensureAuth();
    if (!ok) return;

    const parsedSessionId = this.parseRouteSessionId();
    if (!parsedSessionId) {
      this.error = 'Некорректный id сессии.';
      this.loading = false;
      return;
    }

    this.sessionId = parsedSessionId;

    this.gamesSessionHandler = (payload: any) => {
      this.onGamesSession(payload);
    };
    this.gamesStateHandler = (payload: any) => {
      this.onGamesState(payload);
    };
    this.chatMessageHandler = (payload: any) => {
      this.onChatMessage(payload);
    };

    on('game:session:updated', this.gamesSessionHandler);
    on('game:state:updated', this.gamesStateHandler);
    on('message:created', this.chatMessageHandler);

    await this.fetchSession();
  },

  beforeUnmount(this: any) {
    this.gamesSessionHandler && off('game:session:updated', this.gamesSessionHandler);
    this.gamesStateHandler && off('game:state:updated', this.gamesStateHandler);
    this.chatMessageHandler && off('message:created', this.chatMessageHandler);
  },
};
