import { useState, useEffect, useRef, useCallback, useMemo, ChangeEvent } from 'react'
import { motion } from 'framer-motion'
import {
  Loader2, Send, Eye, MessageSquare, Paperclip, X, Download,
  FileText, FileImage, FileSpreadsheet, File, FileArchive, RefreshCw,
  Reply, Copy, Forward, Trash2, Search, Check, SmilePlus, Pencil,
  Pin, PinOff, Bell, BellOff, ChevronDown, MessagesSquare,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { roomAPI } from '../../lib/api'
import { getSocket } from '../../lib/socket'
import { buildThreadChildren, buildIdSet, collectDescendantIds } from './threadUtils'
import {
  isRoomMutedLocal,
  setRoomMutedLocal,
  writeMutedLocal,
  notifyMuteChanged,
  MUTE_CHANGED_EVENT,
} from './roomMute'
import {
  FILE_API_BASE,
  MAX_FILE_SIZE,
  BLOCKED_EXTENSIONS,
  ACCEPT_ATTR,
  GROUP_WINDOW_MS,
  MESSAGE_WINDOW,
  QUICK_EMOJIS,
  formatTime,
  readOnlyNotice,
  resolveFileUrl,
  formatFileSize,
  replyPreviewText,
  startOfDayMs,
  dayKey,
  dayLabel,
  buildRenderItems,
} from './chatUtils';
export {
  FILE_API_BASE,
  MAX_FILE_SIZE,
  BLOCKED_EXTENSIONS,
  ACCEPT_ATTR,
  GROUP_WINDOW_MS,
  MESSAGE_WINDOW,
  QUICK_EMOJIS,
  formatTime,
  readOnlyNotice,
  resolveFileUrl,
  formatFileSize,
  replyPreviewText,
  startOfDayMs,
  dayKey,
  dayLabel,
  buildRenderItems,
};
import Modal from '../ui/Modal'
import { optimizeCloudinaryUrl, cloudinarySrcSet, cloudinaryLqip, isCloudinaryDeliveryUrl } from '../../lib/cloudinary'

// Chat constants + pure helpers live in ./chatUtils.ts (SRP split). Re-exported above for compat.

interface ReplyPreview {
  id: string
  senderName: string
  content: string
  hasAttachment: boolean
}

interface Reaction {
  emoji: string
  count: number
  userIds: string[]
}

interface ChatMessage {
  id: string
  roomId: string
  senderId: string
  content: string
  createdAt: string
  updatedAt?: string
  fileUrl?: string | null
  fileName?: string | null
  fileType?: string | null
  fileSize?: number | null
  isDeleted?: boolean
  deletedAt?: string | null
  isForwarded?: boolean
  // Threads-lite (#8): pins + reply counts ride the wire (see serializeRoomMessage)
  isPinned?: boolean
  pinnedAt?: string | null
  pinnedBy?: string | null
  replyCount?: number
  rank?: number
  match?: 'exact' | 'prefix' | 'fuzzy'
  replyTo?: ReplyPreview | null
  sender?: { id: string; name: string; email: string; avatar?: string | null }
  reactions?: Reaction[]
  myReactions?: string[]
}

interface PendingMessage {
  tempId: string
  content: string
  createdAt: string
  fileName?: string
  fileSize?: number
  replyTo?: ReplyPreview | null
}

// Uniform shape for rendering saved + optimistic messages side by side
interface DisplayMessage {
  id: string
  senderId: string
  content: string
  createdAt: string
  updatedAt?: string
  isEdited?: boolean
  isPending?: boolean
  sender?: ChatMessage['sender']
  fileUrl?: string | null
  fileName?: string | null
  fileType?: string | null
  fileSize?: number | null
  isDeleted?: boolean
  isForwarded?: boolean
  isPinned?: boolean
  pinnedAt?: string | null
  pinnedBy?: string | null
  replyCount?: number
  rank?: number
  match?: 'exact' | 'prefix' | 'fuzzy'
  replyTo?: ReplyPreview | null
  reactions?: Reaction[]
  myReactions?: string[]
}

interface RoomChatPanelProps {
  roomId: string
  canChat: boolean
  chatMode: string
  currentUserId: string
  /** Sender OR creator OR college-admin may tombstone a message for everyone */
  canDeleteForEveryone: boolean
  /** Teacher OR CR may pin/unpin (drives the pin affordances + pinned bar writes) */
  canPin?: boolean
}



// Absolute-URL guard: cloud storage returns absolute URLs, local uploads are root-relative


// ── Reactions ──────────────────────────────────────────────────

// Reaction chips rendered below a message bubble
function ReactionChips({
  reactions,
  myReactions,
  onToggle,
  isOwn,
}: {
  reactions: Reaction[]
  myReactions: string[]
  onToggle: (emoji: string) => void
  isOwn: boolean
}) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className={clsx('flex flex-wrap gap-1 mt-1', isOwn ? 'justify-end' : 'justify-start')}>
      {reactions.map((r) => {
        const isMine = myReactions.includes(r.emoji)
        return (
          <button
            key={r.emoji}
            onClick={(e) => { e.stopPropagation(); onToggle(r.emoji) }}
            className={clsx(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium transition-colors border',
              isMine
                ? 'bg-primary-50 dark:bg-primary-500/15 border-primary-300 dark:border-primary-500/40 text-primary-700 dark:text-primary-200'
                : 'bg-surface-50 dark:bg-night-800 border-surface-200 dark:border-night-600 text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700'
            )}
            title={isMine ? `Remove ${r.emoji}` : `React with ${r.emoji}`}
          >
            <span>{r.emoji}</span>
            <span className="tabular-nums">{r.count}</span>
          </button>
        )
      })}
    </div>
  )
}

// Mini emoji picker grid (shown on hover/tap)
function EmojiPicker({
  onSelect,
  onClose,
  isOwn,
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
  isOwn: boolean
}) {
  return (
    <div
      className={clsx(
        'absolute z-20 mt-1 flex gap-0.5 p-1.5 rounded-xl bg-white dark:bg-night-800 border border-surface-100 dark:border-night-600 shadow-lg',
        isOwn ? 'right-0' : 'left-0'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={(e) => { e.stopPropagation(); onSelect(emoji); onClose() }}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-100 dark:hover:bg-night-700 text-base transition-colors dark:bg-[#1e1e1e]"
          title={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

// Quoted-chip fallback text: prefer content, else attachment hint

function FileIcon({ fileName }: { fileName: string }) {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return <FileText size={18} className="text-danger-500 shrink-0" />
  if (ext === 'ppt' || ext === 'pptx') return <FileImage size={18} className="text-warning-500 shrink-0" />
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return <FileSpreadsheet size={18} className="text-primary-500 shrink-0" />
  if (ext === 'doc' || ext === 'docx') return <FileText size={18} className="text-primary-500 shrink-0" />
  if (ext === 'zip' || ext === 'rar') return <FileArchive size={18} className="text-accent-500 shrink-0" />
  if (ext === 'txt') return <FileText size={18} className="text-surface-400 dark:text-night-300 shrink-0" />
  return <File size={18} className="text-surface-400 dark:text-night-300 shrink-0" />
}

// Saved attachment: images render inline (lazy-loaded, falls back to a download card on error),
// everything else renders as an attachment card with icon + size + download
function MessageAttachment({
  fileUrl,
  fileName,
  fileType,
  fileSize,
}: {
  fileUrl: string
  fileName?: string | null
  fileType?: string | null
  fileSize?: number | null
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const url = resolveFileUrl(fileUrl)
  const name = fileName || 'attachment'
  // P0-C images: Cloudinary delivery gets f_auto/q_auto + responsive srcset
  // (AVIF/WebP negotiation, ~40-60% bytes saved); every other host passes
  // through UNCHANGED (fail-open). LQIP blurs up behind the sharp image.
  const optimizedUrl = optimizeCloudinaryUrl(url, { width: 640 })
  const srcSet = isCloudinaryDeliveryUrl(url) ? cloudinarySrcSet(url, [320, 480, 640]) : undefined
  const lqip = isCloudinaryDeliveryUrl(url) ? cloudinaryLqip(url) : undefined

  if (fileType === 'image' && !imageFailed) {
    return (
      <div
        className="relative inline-block rounded-xl overflow-hidden border border-surface-200 dark:border-night-600"
        style={lqip ? { backgroundImage: `url("${lqip}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <img
          src={optimizedUrl}
          srcSet={srcSet}
          sizes="(max-width: 640px) 70vw, 240px"
          alt={name}
          loading="lazy"
          decoding="async"
          width={240}
          height={220}
          onError={() => setImageFailed(true)}
          className="max-w-[240px] max-h-[220px] object-cover block"
        />
        <a
          href={url}
          download={name}
          title={`Download ${name}`}
          className="absolute bottom-1.5 right-1.5 p-1.5 rounded-lg bg-black/55 text-white hover:bg-black/75 transition-colors"
        >
          <Download size={13} />
        </a>
      </div>
    )
  }

  return (
    <a
      href={url}
      download={name}
      className="flex items-center gap-2.5 pl-2.5 pr-3 py-2 rounded-xl bg-white/60 dark:bg-night-850/60 border border-surface-200 dark:border-night-600 hover:border-primary-400 dark:hover:border-primary-500 transition-colors max-w-[260px]"
    >
      <FileIcon fileName={name} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-surface-900 dark:text-night-50 truncate">{name}</span>
        <span className="block text-[10px] text-surface-400 dark:text-night-300">
          {formatFileSize(fileSize) || 'Tap to download'}
        </span>
      </span>
      <Download size={14} className="text-surface-400 dark:text-night-300 shrink-0" />
    </a>
  )
}

// Optimistic placeholder shown while an attachment message is uploading
function PendingAttachment({ fileName, fileSize }: { fileName: string; fileSize?: number }) {
  return (
    <div className="flex items-center gap-2.5 pl-2.5 pr-3 py-2 rounded-xl bg-white/60 dark:bg-night-850/60 border border-dashed border-surface-300 dark:border-night-500 max-w-[260px] opacity-80">
      <FileIcon fileName={fileName} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-surface-900 dark:text-night-50 truncate">{fileName}</span>
        <span className="block text-[10px] text-surface-400 dark:text-night-300">{formatFileSize(fileSize)}</span>
      </span>
      <Loader2 size={13} className="animate-spin text-surface-400 dark:text-night-300 shrink-0" />
    </div>
  )
}

// Quoted parent block rendered above a reply's body
function QuotedBlock({ reply }: { reply: ReplyPreview }) {
  return (
    <div className="max-w-full rounded-lg border-l-2 border-primary-400 dark:border-primary-500 bg-surface-50 dark:bg-night-850/80 px-2.5 py-1.5">
      <p className="text-[11px] font-semibold text-primary-600 dark:text-primary-300 truncate">
        {reply.senderName}
      </p>
      <p className="text-[11px] text-surface-500 dark:text-night-200 truncate">
        {replyPreviewText(reply)}
      </p>
    </div>
  )
}

// Tombstone replaces deleted-for-everyone messages: no content, no attachment
function Tombstone({ isOwn }: { isOwn: boolean }) {
  return (
    <div
      className={clsx(
        'px-3.5 py-2 rounded-2xl text-sm italic rounded-br-md',
        isOwn
          ? 'bg-primary-500/10 text-primary-300'
          : 'bg-surface-100 dark:bg-night-700 text-surface-400 dark:text-night-300 rounded-bl-md'
      )}
    >
      This message was deleted
    </div>
  )
}




function ChatSkeleton() {
  const rows = [
    { own: false, w: 'w-3/5' },
    { own: false, w: 'w-2/5' },
    { own: true, w: 'w-1/2' },
    { own: false, w: 'w-2/3' },
    { own: true, w: 'w-3/5' },
  ]
  return (
    <div className="p-4 space-y-4 animate-pulse" aria-hidden>
      {rows.map((row, i) => (
        <div key={i} className={clsx('flex items-end gap-2', row.own ? 'justify-end' : 'justify-start')}>
          {!row.own && <div className="w-7 h-7 rounded-full bg-surface-100 dark:bg-night-700 shrink-0" />}
          <div className={clsx('h-9 rounded-2xl bg-surface-100 dark:bg-night-700', row.w)} />
        </div>
      ))}
    </div>
  )
}

// Forward modal: searchable checkbox list of the user's other rooms where they canChat
function ForwardModal({
  open,
  onClose,
  sourceRoomId,
  messageId,
}: {
  open: boolean
  onClose: () => void
  sourceRoomId: string
  messageId: string
}) {
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setSearch('')
    setSelected(new Set())
    ;(async () => {
      try {
        const all = await roomAPI.getAll()
        // Backend computes canChat per room (chatMode + membership); invalid targets are skipped server-side too
        const checked = await Promise.all(
          (all as any[])
            .filter((r) => r.id !== sourceRoomId)
            .map(async (r) => {
              try {
                const detail = await roomAPI.getOne(r.id)
                return detail?.canChat ? { id: r.id, name: r.name } : null
              } catch {
                return null
              }
            })
        )
        if (!cancelled) setRooms(checked.filter((r): r is { id: string; name: string } => !!r))
      } catch {
        if (!cancelled) {
          toast.error('Failed to load your rooms')
          setRooms([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, sourceRoomId])

  const toggleRoom = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSend = async () => {
    if (selected.size === 0 || sending) return
    setSending(true)
    try {
      const res = await roomAPI.forwardMessage(sourceRoomId, messageId, Array.from(selected))
      toast.success(res.message || `Forwarded to ${res.forwarded} room(s)`)
      if (Array.isArray(res.skipped) && res.skipped.length > 0) {
        toast.error(`${res.skipped.length} room(s) could not receive the message`)
      }
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to forward message')
    } finally {
      setSending(false)
    }
  }

  const filtered = rooms.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <Modal open={open} onClose={onClose} title="Forward message" size="md">
      <div className="space-y-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-300" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rooms..."
            className="w-full pl-9 pr-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-surface-50 dark:bg-night-850 text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
          />
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1 -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-primary-500" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-surface-400 dark:text-night-300 py-8">
              No other rooms you can send to
            </p>
          ) : (
            filtered.map((room) => {
              const isSelected = selected.has(room.id)
              return (
                <button
                  key={room.id}
                  onClick={() => toggleRoom(room.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
                    isSelected
                      ? 'bg-primary-50 dark:bg-primary-500/10'
                      : 'hover:bg-surface-100 dark:hover:bg-night-700'
                  )}
                >
                  <span
                    className={clsx(
                      'w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
                      isSelected
                        ? 'bg-primary-500 border-primary-500 text-white'
                        : 'border-surface-300 dark:border-night-500'
                    )}
                  >
                    {isSelected && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-surface-900 dark:text-night-50 truncate">
                    {room.name}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={selected.size === 0 || sending}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:shadow-lg disabled:opacity-50 transition-all"
        >
          {sending ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Sending to {selected.size} room{selected.size === 1 ? '' : 's'}...
            </>
          ) : (
            <>
              <Forward size={15} />
              Send to {selected.size} room{selected.size === 1 ? '' : 's'}
            </>
          )}
        </button>
      </div>
    </Modal>
  )
}

export default function RoomChatPanel({ roomId, canChat, chatMode, currentUserId, canDeleteForEveryone, canPin = false }: RoomChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [forwardTarget, setForwardTarget] = useState<DisplayMessage | null>(null)
  const [deleteMenuFor, setDeleteMenuFor] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<{ messageId: string; originalContent: string } | null>(null)
  // ── Threads-lite (#8) ──────────────────────────────────────────
  // Pins: server list (pinned bar) + socket 'room:message:pin' live updates.
  const [pins, setPins] = useState<ChatMessage[]>([])
  const [pinsCollapsed, setPinsCollapsed] = useState(false)
  // Threads: expanded parent ids (children nest under the parent when open).
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  // Ranked search: server-ranked (exact > prefix > fuzzy), debounced.
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  // Per-channel mute: localStorage first (offline), backend pref reconciles.
  const [muted, setMuted] = useState(() => isRoomMutedLocal(roomId))
  // Jump-to-message flash (pins / search / thread deep-links).
  const [flashId, setFlashId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nearBottomRef = useRef(true)
  const forceScrollRef = useRef(false)
  const initialIdsRef = useRef<Set<string> | null>(null)
  // Windowing: only the latest N messages are mounted (fast like Discord).
  const [visibleCount, setVisibleCount] = useState(MESSAGE_WINDOW)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  // Total mounted-message count for jump-to-message (pins/search deep-links).
  const totalMessagesRef = useRef(0)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Close emoji picker on outside click
  useEffect(() => {
    if (!emojiPickerFor) return
    const handler = () => setEmojiPickerFor(null)
    // Delay to avoid the same click that opened it from closing it immediately
    const timer = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handler)
    }
  }, [emojiPickerFor])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }, [])

  // Reset window when switching rooms.
  useEffect(() => {
    setVisibleCount(MESSAGE_WINDOW)
    initialIdsRef.current = null
    // Threads-lite: room-scoped UI resets with the room.
    setExpandedThreads(new Set())
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
    setFlashId(null)
    setPinsCollapsed(false)
  }, [roomId])

  // Pinned bar: fetch on room change (501 when the pins migration is pending → empty bar).
  useEffect(() => {
    let cancelled = false
    setPins([])
    roomAPI.getPins(roomId).then((data: ChatMessage[]) => {
      if (!cancelled) setPins(Array.isArray(data) ? data : [])
    }).catch(() => { if (!cancelled) setPins([]) })
    return () => { cancelled = true }
  }, [roomId])

  // Per-channel mute: local first, backend pref reconciles (backend wins).
  useEffect(() => {
    setMuted(isRoomMutedLocal(roomId))
    let cancelled = false
    roomAPI.getMutedRooms().then((d) => {
      if (cancelled || !d || !Array.isArray(d.mutedRoomIds)) return
      writeMutedLocal(d.mutedRoomIds)
      setMuted(d.mutedRoomIds.includes(roomId))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [roomId])

  // Mute toggled elsewhere (detail header, another tab) → sync instantly.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ roomId: string; muted: boolean }>).detail
      if (detail?.roomId === roomId) setMuted(!!detail.muted)
    }
    window.addEventListener(MUTE_CHANGED_EVENT, handler as EventListener)
    return () => window.removeEventListener(MUTE_CHANGED_EVENT, handler as EventListener)
  }, [roomId])

  // Ranked search (debounced; min 2 chars to avoid flooding on every keystroke).
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearchError(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      roomAPI.searchMessages(roomId, q)
        .then((d: { data?: ChatMessage[] }) => {
          setSearchResults(Array.isArray(d?.data) ? d.data : [])
          setSearchError(null)
        })
        .catch(() => {
          setSearchResults([])
          setSearchError('Search failed — try again')
        })
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, roomId])

  const loadMore = useCallback(() => {
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    const prevTop = el?.scrollTop ?? 0
    setVisibleCount((c) => c + MESSAGE_WINDOW)
    // Preserve scroll position after mounting older rows (no jump).
    requestAnimationFrame(() => {
      const node = scrollRef.current
      if (node) {
        const delta = node.scrollHeight - prevHeight
        node.scrollTop = prevTop + delta
      }
    })
  }, [])

  const markRead = useCallback(() => {
    roomAPI.markRead(roomId).then(() => {
      window.dispatchEvent(new CustomEvent('room:read', { detail: { roomId } }))
    }).catch(() => {})
  }, [roomId])

  const loadMessages = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    roomAPI.getMessages(roomId)
      .then((data: ChatMessage[]) => {
        if (!initialIdsRef.current) initialIdsRef.current = new Set(data.map((m) => m.id))
        setMessages(data)
        // mark read after messages are viewed
        markRead()
      })
      .catch(() => { setLoadError(true); toast.error('Failed to load messages') })
      .finally(() => setLoading(false))
  }, [roomId, markRead])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // When roomId changes or chat becomes visible, ensure read
  useEffect(() => {
    if (!loading) markRead()
  }, [roomId, loading, markRead])

  // Live updates via Socket.IO (broadcasts target personal user rooms)
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const handler = (message: ChatMessage) => {
      if (message.roomId !== roomId) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev
        return [...prev, message]
      })
      // Threads-lite: a new reply auto-expands its parent thread so it is visible
      // even when the parent sits outside the mounted window (pulled in below).
      if (message.replyTo?.id) {
        const parentId = message.replyTo.id
        setExpandedThreads((prev) => {
          if (prev.has(parentId)) return prev
          const next = new Set(prev)
          next.add(parentId)
          return next
        })
      }
      // When chat is open, mark read immediately so sidebar badge does not increment
      if (message.senderId !== currentUserId) {
        markRead()
      }
    }
    socket.on('room:message:new', handler)

    // Deleted-for-everyone: swap the bubble for a tombstone. Messages this user
    // hid earlier aren't in local state, so nothing to remove for those.
    const deleteHandler = (payload: { messageId: string; roomId: string }) => {
      if (payload.roomId !== roomId) return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? { ...m, isDeleted: true, deletedAt: new Date().toISOString(), content: '', fileUrl: null, fileName: null, fileType: null, fileSize: null }
            : m
        )
      )
    }
    socket.on('room:message:deleted', deleteHandler)

    // Reaction updates from other users
    const reactionHandler = (payload: {
      messageId: string
      roomId: string
      userId: string
      emoji: string
      action: 'added' | 'removed'
      reactions: Record<string, number>
      myReactionsByUser?: Record<string, string[]>
    }) => {
      if (payload.roomId !== roomId) return
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== payload.messageId) return m
          // Build reactions array from the server-side grouped counts
          const reactions: Reaction[] = Object.entries(payload.reactions).map(([emoji, count]) => {
            const userids = payload.myReactionsByUser?.[emoji] ? Object.keys(payload.myReactionsByUser) : []
            // Use the myReactionsByUser data to know which user reacted with what
            return { emoji, count, userIds: [] }
          })
          // Use the myReactionsByUser map to compute myReactions for this client's user
          const myReactions: string[] = []
          if (payload.myReactionsByUser) {
            for (const [uid, emojis] of Object.entries(payload.myReactionsByUser)) {
              if (uid === currentUserId) {
                myReactions.push(...emojis)
              }
            }
          }
          return { ...m, reactions, myReactions }
        })
      )
    }
    socket.on('room:message:reaction', reactionHandler)

    // Edited message: update content and set edited flag
    const editHandler = (payload: { messageId: string; roomId: string; content: string; editedAt: string }) => {
      if (payload.roomId !== roomId) return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? { ...m, content: payload.content, updatedAt: payload.editedAt, isEdited: true }
            : m
        )
      )
    }
    socket.on('room:message:edited', editHandler)

    // Threads-lite: pin/unpin fan-out — flip the wire flag inline; a new pin
    // refetches the pinned bar (needs the full serialized row for previews).
    const pinHandler = (payload: { messageId: string; roomId: string; isPinned: boolean; pinnedBy?: string | null }) => {
      if (payload.roomId !== roomId) return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? { ...m, isPinned: payload.isPinned, pinnedBy: payload.pinnedBy ?? (payload.isPinned ? m.pinnedBy : null) }
            : m
        )
      )
      if (payload.isPinned) {
        roomAPI.getPins(roomId).then((data: ChatMessage[]) => setPins(Array.isArray(data) ? data : [])).catch(() => {})
      } else {
        setPins((prev) => prev.filter((p) => p.id !== payload.messageId))
      }
    }
    socket.on('room:message:pin', pinHandler)

    return () => {
      socket.off('room:message:new', handler)
      socket.off('room:message:deleted', deleteHandler)
      socket.off('room:message:reaction', reactionHandler)
      socket.off('room:message:edited', editHandler)
      socket.off('room:message:pin', pinHandler)
    }
  }, [roomId, currentUserId, markRead])

  // Polling fallback keeps the list fresh when the socket is disconnected
  // PERPAGE-HALF1: skip the tick while the socket is live — socket handlers
  // above already apply new/edited/deleted/reacted messages instantly, so the
  // unconditional 15s GET duplicated every message (4 GETs/min/room while
  // chatting). Disconnected behavior identical (fallback still polls).
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        if (getSocket()?.connected) return
      } catch { /* fall through to poll */ }
      roomAPI.getMessages(roomId).then((data: ChatMessage[]) => setMessages(data)).catch(() => {})
    }, 15000)
    return () => clearInterval(interval)
  }, [roomId])

  // Jump instantly once history is loaded
  useEffect(() => {
    if (loading) return
    scrollToBottom(false)
  }, [loading, scrollToBottom])

  // Smooth-follow new content only when the reader is already near the bottom
  useEffect(() => {
    if (loading) return
    if (forceScrollRef.current) {
      forceScrollRef.current = false
      nearBottomRef.current = true
      scrollToBottom(true)
      return
    }
    if (nearBottomRef.current) scrollToBottom(true)
  }, [messages.length, pending.length, loading, scrollToBottom])

  const handleFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    e.target.value = '' // allow re-picking the same file after removal
    if (!file) return
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File too large (max 10MB)')
      return
    }
    const dotIdx = file.name.lastIndexOf('.')
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : ''
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      toast.error('This file type is not allowed')
      return
    }
    setSelectedFile(file)
  }

  const handleSend = async () => {
    const content = draft.trim()

    // Edit mode: update existing message
    if (editingMessage) {
      if (!content || sending) return
      setSending(true)
      try {
        const updated = await roomAPI.editMessage(roomId, editingMessage.messageId, content)
        // Optimistic update local state
        setMessages((prev) =>
          prev.map((m) =>
            m.id === editingMessage.messageId
              ? { ...m, content: updated.content, updatedAt: updated.updatedAt, isEdited: true }
              : m
          )
        )
        setEditingMessage(null)
        setDraft('')
        toast.success('Message edited')
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Failed to edit message')
      } finally {
        setSending(false)
      }
      return
    }

    // Normal send mode
    if ((!content && !selectedFile) || sending) return

    const tempId = `temp-${Date.now()}`
    const fileToSend = selectedFile
    const replySnapshot: ReplyPreview | null = replyTo
      ? {
          id: replyTo.id,
          senderName: replyTo.sender?.name || 'Member',
          content: replyTo.isDeleted ? '' : replyTo.content || '',
          hasAttachment: !replyTo.isDeleted && !!replyTo.fileUrl,
        }
      : null
    forceScrollRef.current = true
    setDraft('')
    setSelectedFile(null)
    setReplyTo(null)
    setPending((prev) => [
      ...prev,
      {
        tempId,
        content,
        createdAt: new Date().toISOString(),
        ...(fileToSend ? { fileName: fileToSend.name, fileSize: fileToSend.size } : {}),
        ...(replySnapshot ? { replyTo: replySnapshot } : {}),
      },
    ])
    setSending(true)
    try {
      const saved: ChatMessage = await roomAPI.sendMessage(roomId, {
        content: content || undefined,
        file: fileToSend ?? undefined,
        replyToId: replySnapshot?.id,
      })
      initialIdsRef.current?.add(saved.id)
      setPending((prev) => prev.filter((p) => p.tempId !== tempId))
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]))
    } catch (err: any) {
      // Restore draft + selection + reply context so nothing the user typed/picked is lost
      setPending((prev) => prev.filter((p) => p.tempId !== tempId))
      setDraft(content)
      if (fileToSend) setSelectedFile(fileToSend)
      if (replySnapshot) {
        setReplyTo(messages.find((m) => m.id === replySnapshot.id) ?? null)
      }
      // Upload-audit-all: honest errors — backend reason (scan/size/type)
      // first, timeout hint for aborted multipart (60s budget), generic last.
      const backendMsg = err?.response?.data?.error
      if (backendMsg) toast.error(String(backendMsg))
      else {
        const msg = String(err?.message || '')
        const isTimeout = err?.code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('exceeded')
        toast.error(isTimeout ? 'Send timed out — large files take up to 60s, please retry' : 'Failed to send message')
      }
    } finally {
      setSending(false)
    }
  }

  const handleCopy = async (msg: DisplayMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Could not copy message')
    }
  }

  const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
    // Optimistic update: toggle locally
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m
        const myReactions = m.myReactions || []
        const alreadyReacted = myReactions.includes(emoji)
        const reactions = [...(m.reactions || [])]

        if (alreadyReacted) {
          // Remove our reaction
          const newMyReactions = myReactions.filter((e) => e !== emoji)
          const idx = reactions.findIndex((r) => r.emoji === emoji)
          if (idx >= 0) {
            if (reactions[idx].count <= 1) {
              reactions.splice(idx, 1)
            } else {
              reactions[idx] = { ...reactions[idx], count: reactions[idx].count - 1, userIds: reactions[idx].userIds.filter((uid) => uid !== currentUserId) }
            }
          }
          return { ...m, reactions, myReactions: newMyReactions }
        } else {
          // Add our reaction
          const newMyReactions = [...myReactions, emoji]
          const idx = reactions.findIndex((r) => r.emoji === emoji)
          if (idx >= 0) {
            reactions[idx] = { ...reactions[idx], count: reactions[idx].count + 1, userIds: [...reactions[idx].userIds, currentUserId] }
          } else {
            reactions.push({ emoji, count: 1, userIds: [currentUserId] })
          }
          return { ...m, reactions, myReactions: newMyReactions }
        }
      })
    )

    // Server call
    try {
      await roomAPI.toggleReaction(roomId, messageId, emoji)
    } catch {
      // On failure, refetch to revert optimistic update
      roomAPI.getMessages(roomId).then((data: ChatMessage[]) => setMessages(data)).catch(() => {})
      toast.error('Failed to react')
    }
  }, [roomId, currentUserId])

  const handleDelete = async (msg: DisplayMessage, scope: 'me' | 'everyone') => {
    if (deletingId) return
    setDeletingId(msg.id)
    try {
      await roomAPI.deleteMessage(roomId, msg.id, scope)
      if (scope === 'me') {
        setMessages((prev) => prev.filter((m) => m.id !== msg.id))
        toast.success('Message deleted for you')
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id
              ? { ...m, isDeleted: true, deletedAt: new Date().toISOString(), content: '', fileUrl: null, fileName: null, fileType: null, fileSize: null }
              : m
          )
        )
        toast.success('Message deleted for everyone')
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete message')
    } finally {
      setDeletingId(null)
      setDeleteMenuFor(null)
    }
  }

  // ── Threads-lite (#8) actions ──────────────────────────────────

  const toggleThread = useCallback((parentId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }, [])

  const jumpToMessage = useCallback((id: string, parentId?: string | null) => {
    // Mount the full history so off-window targets (pins/search hits) exist,
    // expand the parent thread when jumping to a reply, then scroll + flash.
    if (parentId) {
      setExpandedThreads((prev) => {
        if (prev.has(parentId)) return prev
        const next = new Set(prev)
        next.add(parentId)
        return next
      })
    }
    if (totalMessagesRef.current > 0) setVisibleCount(totalMessagesRef.current)
    setFlashId(id)
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2200)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(`room-msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    })
  }, [])

  const handleTogglePin = useCallback(async (msg: DisplayMessage) => {
    const next = !msg.isPinned
    // Optimistic: flip inline + sync the bar immediately.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id
          ? { ...m, isPinned: next, pinnedAt: next ? new Date().toISOString() : null, pinnedBy: next ? currentUserId : null }
          : m
      )
    )
    setPins((prev) =>
      next
        ? prev.some((p) => p.id === msg.id)
          ? prev
          : [...prev, { ...(msg as unknown as ChatMessage), isPinned: true }]
        : prev.filter((p) => p.id !== msg.id)
    )
    try {
      const saved: ChatMessage = next
        ? await roomAPI.pinMessage(roomId, msg.id)
        : await roomAPI.unpinMessage(roomId, msg.id)
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...saved } : m)))
      if (next) {
        const fresh = await roomAPI.getPins(roomId).catch(() => null)
        if (Array.isArray(fresh)) setPins(fresh)
      }
      toast.success(next ? 'Message pinned' : 'Message unpinned')
    } catch (err: any) {
      // Revert both surfaces so the bar never disagrees with the server.
      roomAPI.getMessages(roomId).then((data: ChatMessage[]) => setMessages(data)).catch(() => {})
      roomAPI.getPins(roomId).then((data: ChatMessage[]) => setPins(Array.isArray(data) ? data : [])).catch(() => setPins([]))
      const status = err?.response?.status
      toast.error(
        status === 501
          ? 'Pins unavailable — server update pending'
          : err?.response?.data?.error || 'Failed to update pin'
      )
    }
  }, [roomId, currentUserId])

  const handleToggleMute = useCallback(async () => {
    const next = !muted
    // Optimistic + local-first (works offline); backend reconciles.
    setMuted(next)
    setRoomMutedLocal(roomId, next)
    notifyMuteChanged(roomId, next)
    try {
      await roomAPI.setRoomMuted(roomId, next)
      toast.success(next ? 'Channel muted — badges off' : 'Channel unmuted')
    } catch {
      // Revert so the bell never lies about server state.
      setMuted(!next)
      setRoomMutedLocal(roomId, !next)
      notifyMuteChanged(roomId, !next)
      toast.error('Failed to save mute — try again')
    }
  }, [roomId, muted])

  const displayMessages: DisplayMessage[] = [
    ...messages.map((m) => {
      const isEdited = m.updatedAt && m.createdAt
        ? new Date(m.updatedAt).getTime() - new Date(m.createdAt).getTime() > 2000
        : false
      return { ...m, isEdited }
    }),
    ...pending.map((p): DisplayMessage => ({
      id: p.tempId,
      senderId: currentUserId,
      content: p.content,
      createdAt: p.createdAt,
      isPending: true,
      fileName: p.fileName ?? null,
      fileSize: p.fileSize ?? null,
      replyTo: p.replyTo ?? null,
    })),
  ]

  // ── Threads-lite (#8) derived state ────────────────────────────
  // replyToId IS the thread parent (same contract as the backend).
  const allMessageIds = useMemo(() => buildIdSet(displayMessages), [displayMessages])
  const childrenByParent = useMemo(() => buildThreadChildren(displayMessages), [displayMessages])
  const threadParentCount = useMemo(() => {
    let n = 0
    for (const pid of childrenByParent.keys()) if (allMessageIds.has(pid)) n++
    return n
  }, [childrenByParent, allMessageIds])
  totalMessagesRef.current = displayMessages.length

  // Window: mount only the latest N (50 + infinite scroll). Full history
  // stays in state for search/counts; DOM stays lean for 200+ rows.
  // Window: mount only the latest N (50 + infinite scroll) + pull in
  // off-window parents of visible replies (auto-expanded threads stay coherent).
  const hasMore = visibleCount < displayMessages.length
  const hiddenCount = Math.max(0, displayMessages.length - visibleCount)
  const windowedMessages = hasMore ? displayMessages.slice(-visibleCount) : displayMessages
  const visibleMessages = useMemo(() => {
    const ids = new Set(windowedMessages.map((m) => m.id))
    const missing = new Set<string>()
    for (const m of windowedMessages) {
      const pid = m.replyTo?.id
      if (pid && !ids.has(pid)) missing.add(pid)
    }
    if (missing.size === 0) return windowedMessages
    const pulled = displayMessages.filter((m) => missing.has(m.id))
    return [...pulled, ...windowedMessages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  }, [windowedMessages, displayMessages])
  // Expanded threads render nested under their parent — hide those children
  // from the flat flow so nothing renders twice.
  const hiddenNestedIds = useMemo(() => {
    const out = new Set<string>()
    for (const pid of expandedThreads) {
      for (const id of collectDescendantIds(childrenByParent, pid)) out.add(id)
    }
    return out
  }, [expandedThreads, childrenByParent])
  const flatMessages = visibleMessages.filter((m) => !hiddenNestedIds.has(m.id))
  const renderItems = buildRenderItems(flatMessages)

  // Infinite scroll: when the top sentinel enters view, mount 50 more.
  useEffect(() => {
    const sentinel = topSentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { root, rootMargin: '200px 0px 0px 0px', threshold: 0 }
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasMore, visibleMessages.length, loadMore])

  // ── Threads-lite (#8) nested render ────────────────────────────
  // Lite child card (sender + body + reactions + reply/pin) — the full bubble
  // (edit/forward/delete) stays single-sourced in the main flow. Depth-capped
  // at 3; deeper replies keep rendering in the main flow with quote chips.
  const renderNestedReplies = (parentId: string, depth: number) => {
    if (depth > 3) return null
    const kids = childrenByParent.get(parentId) ?? []
    if (kids.length === 0) return null
    return (
      <div className="mt-1.5 space-y-1.5">
        {kids.map((kid) => {
          const kidIsTombstone = !!kid.isDeleted
          const grandkids = childrenByParent.get(kid.id) ?? []
          const kidExpanded = expandedThreads.has(kid.id)
          return (
            <div
              key={kid.id}
              id={`room-msg-${kid.id}`}
              className={clsx(
                'rounded-xl border px-2.5 py-2 scroll-mt-4 transition-shadow',
                flashId === kid.id
                  ? 'border-primary-400 ring-2 ring-primary-400/60'
                  : 'border-surface-100 dark:border-night-600 bg-surface-50/70 dark:bg-night-850/50'
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-[9px] font-bold text-primary-600 dark:text-primary-300 shrink-0">
                  {(kid.sender?.name || 'M').charAt(0).toUpperCase()}
                </span>
                <span className="text-[11px] font-semibold text-surface-700 dark:text-night-100 truncate">
                  {kid.sender?.name || 'Member'}
                </span>
                <span className="text-[10px] text-surface-400 dark:text-night-300 shrink-0">
                  {formatTime(kid.createdAt)}
                </span>
                {kid.isPinned && <Pin size={10} className="text-primary-500 shrink-0" />}
              </div>
              {kidIsTombstone ? (
                <p className="mt-1 text-xs italic text-surface-400 dark:text-night-300">This message was deleted</p>
              ) : (
                <>
                  {kid.replyTo && <QuotedBlock reply={kid.replyTo} />}
                  {kid.content && (
                    <p className="mt-1 text-[13px] break-words whitespace-pre-wrap text-surface-900 dark:text-night-50">
                      {kid.content}
                    </p>
                  )}
                  {!!kid.fileUrl && !kid.isPending && (
                    <div className="mt-1">
                      <MessageAttachment
                        fileUrl={kid.fileUrl}
                        fileName={kid.fileName}
                        fileType={kid.fileType}
                        fileSize={kid.fileSize}
                      />
                    </div>
                  )}
                  <ReactionChips
                    reactions={kid.reactions || []}
                    myReactions={kid.myReactions || []}
                    onToggle={(emoji) => handleToggleReaction(kid.id, emoji)}
                    isOwn={kid.senderId === currentUserId}
                  />
                </>
              )}
              <div className="mt-1 flex items-center gap-1">
                {canChat && !kidIsTombstone && !kid.isPending && (
                  <button
                    onClick={() => {
                      const full = messages.find((m) => m.id === kid.id)
                      if (full) setReplyTo(full)
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-medium text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                    title="Reply in this thread"
                  >
                    <Reply size={11} /> Reply
                  </button>
                )}
                {canPin && !kidIsTombstone && !kid.isPending && (
                  <button
                    onClick={() => handleTogglePin(kid)}
                    className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-medium text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                    title={kid.isPinned ? 'Unpin' : 'Pin'}
                  >
                    {kid.isPinned ? <PinOff size={11} /> : <Pin size={11} />}
                    {kid.isPinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
                {grandkids.length > 0 && depth < 3 && (
                  <button
                    onClick={() => toggleThread(kid.id)}
                    className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-primary-600 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                  >
                    <ChevronDown size={11} className={clsx('transition-transform', kidExpanded && 'rotate-180')} />
                    {kidExpanded ? 'Hide' : 'View'} {grandkids.length} {grandkids.length === 1 ? 'reply' : 'replies'}
                  </button>
                )}
                {grandkids.length > 0 && depth >= 3 && (
                  <span className="text-[10px] text-surface-400 dark:text-night-300 italic">
                    +{grandkids.length} deeper in main chat
                  </span>
                )}
              </div>
              {kidExpanded && depth < 3 && (
                <div className="mt-1 pl-2 border-l-2 border-primary-200 dark:border-primary-500/40">
                  {renderNestedReplies(kid.id, depth + 1)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const renderThreadSection = (parent: DisplayMessage, isOwnParent: boolean) => {
    const kids = childrenByParent.get(parent.id) ?? []
    if (kids.length === 0) return null
    const expanded = expandedThreads.has(parent.id)
    return (
      <div className={clsx('mt-1 flex', isOwnParent ? 'justify-end' : 'justify-start')}>
        <div className="min-w-0 max-w-[85%]">
          <button
            onClick={() => toggleThread(parent.id)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-surface-100 dark:bg-night-700 text-primary-600 dark:text-primary-300 hover:bg-surface-200 dark:hover:bg-night-600 transition-colors"
            aria-expanded={expanded}
            title={expanded ? 'Collapse thread' : 'Expand thread'}
          >
            <MessagesSquare size={11} />
            {expanded ? 'Hide' : 'View'} {kids.length} {kids.length === 1 ? 'reply' : 'replies'}
            <ChevronDown size={11} className={clsx('transition-transform', expanded && 'rotate-180')} />
          </button>
          {expanded && (
            <div className="mt-1 pl-2 border-l-2 border-primary-200 dark:border-primary-500/40">
              {renderNestedReplies(parent.id, 1)}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[560px] bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 overflow-hidden shadow-sm">
      {/* ── Threads-lite toolbar: ranked search + per-channel mute ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-100 dark:border-night-600 bg-surface-50/60 dark:bg-night-850/40">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-300" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in this room..."
            aria-label="Search messages in this room"
            className="w-full pl-8 pr-7 py-1.5 rounded-xl text-xs bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchError(null) }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-surface-400 hover:text-danger-500 transition-colors"
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {threadParentCount > 0 && (
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-300 shrink-0" title={`${threadParentCount} threads in this room`}>
            <MessagesSquare size={11} /> {threadParentCount}
          </span>
        )}
        <button
          onClick={handleToggleMute}
          className={clsx(
            'p-2 rounded-xl transition-colors shrink-0',
            muted
              ? 'bg-warning-500/15 text-warning-600 dark:text-warning-400'
              : 'text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10'
          )}
          title={muted ? 'Unmute this channel (badges on)' : 'Mute this channel (badges off)'}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute channel' : 'Mute channel'}
        >
          {muted ? <BellOff size={15} /> : <Bell size={15} />}
        </button>
      </div>
      {/* ── Pinned bar ── */}
      {pins.length > 0 && (
        <div className="border-b border-primary-100 dark:border-night-600 bg-primary-50/60 dark:bg-primary-500/5">
          <button
            onClick={() => setPinsCollapsed((c) => !c)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-primary-700 dark:text-primary-300 hover:bg-primary-100/50 dark:hover:bg-primary-500/10 transition-colors"
            aria-expanded={!pinsCollapsed}
            title={pinsCollapsed ? 'Show pinned messages' : 'Hide pinned messages'}
          >
            <Pin size={11} />
            Pinned ({pins.length})
            <ChevronDown size={12} className={clsx('ml-auto transition-transform', pinsCollapsed && '-rotate-90')} />
          </button>
          {!pinsCollapsed && (
            <div className="px-3 pb-2 space-y-1 max-h-28 overflow-y-auto">
              {pins.map((pin) => (
                <div
                  key={pin.id}
                  className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg bg-white dark:bg-night-800 border border-primary-100 dark:border-night-600"
                >
                  <button
                    onClick={() => jumpToMessage(pin.id, pin.replyTo?.id ?? null)}
                    className="min-w-0 flex-1 text-left"
                    title="Jump to pinned message"
                  >
                    <span className="block text-[11px] font-semibold text-surface-800 dark:text-night-100 truncate">
                      {pin.sender?.name || 'Member'}
                    </span>
                    <span className="block text-[11px] text-surface-500 dark:text-night-200 truncate">
                      {pin.isDeleted ? 'This message was deleted' : (pin.content || (pin.fileName ? `Attachment: ${pin.fileName}` : 'Message'))}
                    </span>
                  </button>
                  {canPin && (
                    <button
                      onClick={() => handleTogglePin(pin as unknown as DisplayMessage)}
                      className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors shrink-0"
                      title="Unpin"
                    >
                      <PinOff size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* ── Ranked search results ── */}
      {searchQuery.trim().length >= 2 && (
        <div className="border-b border-surface-100 dark:border-night-600 bg-white dark:bg-night-800 max-h-44 overflow-y-auto">
          {searching ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-surface-500 dark:text-night-200">
              <Loader2 size={13} className="animate-spin text-primary-500" /> Searching...
            </div>
          ) : searchError ? (
            <p className="px-3 py-2.5 text-xs text-danger-500">{searchError}</p>
          ) : searchResults.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-surface-400 dark:text-night-300">
              No matches for “{searchQuery.trim()}”
            </p>
          ) : (
            <div className="py-1">
              <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-surface-400 dark:text-night-300">
                {searchResults.length} match{searchResults.length === 1 ? '' : 'es'} — exact first
              </p>
              {searchResults.map((hit) => (
                <button
                  key={hit.id}
                  onClick={() => jumpToMessage(hit.id, hit.replyTo?.id ?? null)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-100 dark:hover:bg-night-700 transition-colors"
                  title="Jump to message"
                >
                  <span
                    className={clsx(
                      'shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide',
                      hit.match === 'exact' && 'bg-primary-500 text-white',
                      hit.match === 'prefix' && 'bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300',
                      hit.match === 'fuzzy' && 'bg-surface-200 dark:bg-night-600 text-surface-500 dark:text-night-200'
                    )}
                  >
                    {hit.match || 'match'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-surface-800 dark:text-night-100 truncate">
                      {hit.sender?.name || 'Member'}
                      <span className="ml-1.5 font-normal text-surface-400 dark:text-night-300">{formatTime(hit.createdAt)}</span>
                    </span>
                    <span className="block text-xs text-surface-500 dark:text-night-200 truncate">
                      {hit.content || (hit.fileName ? `Attachment: ${hit.fileName}` : 'Message')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <ChatSkeleton />
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <MessageSquare className="w-10 h-10 text-surface-300 dark:text-night-400" />
            <p className="text-surface-500 dark:text-night-200 text-sm">Couldn't load messages.</p>
            <button
              onClick={loadMessages}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-100 hover:bg-surface-200 dark:hover:bg-night-600 transition-colors"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-surface-100 dark:bg-night-700 flex items-center justify-center mb-3">
              <MessageSquare size={24} className="text-surface-400 dark:text-night-300" />
            </div>
            <p className="font-semibold text-surface-700 dark:text-night-100 text-sm">Start the conversation</p>
            <p className="text-surface-400 dark:text-night-300 text-xs mt-1">
              {canChat
                ? 'Say hello — everyone in this room will see your message'
                : 'No messages have been shared in this room yet'}
            </p>
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="flex flex-col items-center gap-2 py-2">
                <div ref={topSentinelRef} aria-hidden="true" className="h-1 w-full" />
                <button
                  onClick={loadMore}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-200 hover:bg-surface-200 dark:hover:bg-night-600 transition-colors"
                >
                  Load earlier messages ({hiddenCount} more)
                </button>
              </div>
            )}
            {!hasMore && <div ref={topSentinelRef} aria-hidden="true" className="h-px w-full" />}
            {renderItems.map(({ msg, showDivider, dividerLabel, startsGroup, endsGroup }) => {
            const isOwn = msg.senderId === currentUserId
            const isTombstone = !!msg.isDeleted
            const hasAttachment = !isTombstone && !!msg.fileUrl
            const animateIn = !initialIdsRef.current?.has(msg.id)
            const canDeleteEveryoneHere = isOwn || canDeleteForEveryone
            return (
              <div
                key={msg.id}
                id={`room-msg-${msg.id}`}
                className={clsx('scroll-mt-4 rounded-xl transition-shadow', flashId === msg.id && 'ring-2 ring-primary-400')}
              >
                {showDivider && (
                  <div className="flex items-center justify-center my-3">
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-100 dark:bg-night-700 text-[10px] font-semibold text-surface-500 dark:text-night-200">
                      {dividerLabel}
                    </span>
                  </div>
                )}
                <motion.div
                  initial={animateIn ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className={clsx(
                    'group/msg flex items-end gap-2',
                    startsGroup ? 'mt-3' : 'mt-0.5',
                    isOwn ? 'justify-end' : 'justify-start'
                  )}
                >
                  {!isOwn && (
                    startsGroup ? (
                      <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-[11px] font-bold text-primary-600 dark:text-primary-300 shrink-0">
                        {(msg.sender?.name || 'M').charAt(0).toUpperCase()}
                      </div>
                    ) : (
                      <div className="w-7 shrink-0" />
                    )
                  )}
                  <div className={clsx('max-w-[75%] min-w-0 flex flex-col gap-1', isOwn ? 'items-end' : 'items-start')}>
                    {!isOwn && startsGroup && (
                      <span className="text-xs font-medium text-surface-500 dark:text-night-200 px-1 truncate max-w-full">
                        {msg.sender?.name || 'Member'}
                      </span>
                    )}
                    {isTombstone ? (
                      <Tombstone isOwn={isOwn} />
                    ) : (
                      <>
                        {msg.replyTo && <QuotedBlock reply={msg.replyTo} />}
                        {msg.content && (
                          <div
                            className={clsx(
                              'px-3.5 py-2 rounded-2xl text-sm break-words whitespace-pre-wrap',
                              isOwn
                                ? 'bg-primary-500 text-white rounded-br-md'
                                : 'bg-surface-100 dark:bg-night-700 text-surface-900 dark:text-night-50 rounded-bl-md'
                            )}
                          >
                            {msg.isForwarded && (
                              <span
                                className={clsx(
                                  'block text-[10px] font-semibold italic mb-0.5 opacity-80',
                                  isOwn ? 'text-primary-100' : 'text-surface-500 dark:text-night-300'
                                )}
                              >
                                Forwarded
                              </span>
                            )}
                            {msg.content}
                            {(msg as any).isEdited && (
                              <span
                                className={clsx(
                                  'block text-[10px] italic mt-0.5 opacity-70',
                                  isOwn ? 'text-primary-100' : 'text-surface-400 dark:text-night-400'
                                )}
                              >
                                edited
                              </span>
                            )}
                          </div>
                        )}
                        {hasAttachment && !msg.isPending && msg.fileUrl && (
                          <div className="flex flex-col gap-0.5">
                            {msg.isForwarded && !msg.content && (
                              <span className="text-[10px] font-semibold italic text-surface-500 dark:text-night-300 px-1">
                                Forwarded
                              </span>
                            )}
                            <MessageAttachment
                              fileUrl={msg.fileUrl}
                              fileName={msg.fileName}
                              fileType={msg.fileType}
                              fileSize={msg.fileSize}
                            />
                          </div>
                        )}
                        {hasAttachment && msg.isPending && msg.fileName && (
                          <PendingAttachment fileName={msg.fileName} fileSize={msg.fileSize ?? undefined} />
                        )}
                        {/* Reaction chips */}
                        {!isTombstone && (
                          <ReactionChips
                            reactions={msg.reactions || []}
                            myReactions={msg.myReactions || []}
                            onToggle={(emoji) => handleToggleReaction(msg.id, emoji)}
                            isOwn={isOwn}
                          />
                        )}
                      </>
                    )}
                    {endsGroup && (
                      <span className="text-[10px] text-surface-400 dark:text-night-300 px-1">
                        {formatTime(msg.createdAt)}
                        {msg.isPending ? ' · sending…' : ''}
                        {msg.isPinned && !msg.isPending ? ' · pinned' : ''}
                      </span>
                    )}
                    {/* Hover/touch action row (same reveal pattern as resources) */}
                    {!msg.isPending && (
                      <div
                        className={clsx(
                          'flex items-center gap-0.5 transition-opacity',
                          isOwn ? 'flex-row-reverse' : '',
                          'sm:opacity-0 sm:group-hover/msg:opacity-100 focus-within:opacity-100'
                        )}
                      >
                        {canChat && !isTombstone && (
                          <div className="relative">
                            <button
                              onClick={() => setEmojiPickerFor(emojiPickerFor === msg.id ? null : msg.id)}
                              className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                              title="React"
                            >
                              <SmilePlus size={13} />
                            </button>
                            {emojiPickerFor === msg.id && (
                              <EmojiPicker
                                isOwn={isOwn}
                                onSelect={(emoji) => handleToggleReaction(msg.id, emoji)}
                                onClose={() => setEmojiPickerFor(null)}
                              />
                            )}
                          </div>
                        )}
                        {canChat && !isTombstone && (
                          <button
                            onClick={() => setReplyTo(msg as ChatMessage)}
                            className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                            title="Reply"
                          >
                            <Reply size={13} />
                          </button>
                        )}
                        {!isTombstone && !!msg.content && (
                          <button
                            onClick={() => handleCopy(msg)}
                            className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                            title="Copy text"
                          >
                            <Copy size={13} />
                          </button>
                        )}
                        {canChat && !isTombstone && (
                          <button
                            onClick={() => setForwardTarget(msg)}
                            className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                            title="Forward"
                          >
                            <Forward size={13} />
                          </button>
                        )}
                        {canPin && !isTombstone && (
                          <button
                            onClick={() => handleTogglePin(msg)}
                            className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                            title={msg.isPinned ? 'Unpin message' : 'Pin message'}
                          >
                            {msg.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                          </button>
                        )}
                        {isOwn && !isTombstone && !!msg.content && (
                          <button
                            onClick={() => {
                              setEditingMessage({ messageId: msg.id, originalContent: msg.content })
                              setDraft(msg.content)
                              setReplyTo(null)
                            }}
                            className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                            title="Edit message"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <div className="relative">
                          <button
                            onClick={() =>
                              canDeleteEveryoneHere && !isTombstone
                                ? setDeleteMenuFor(deleteMenuFor === msg.id ? null : msg.id)
                                : handleDelete(msg, 'me')
                            }
                            disabled={deletingId === msg.id}
                            className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors disabled:opacity-50"
                            title={canDeleteEveryoneHere && !isTombstone ? 'Delete' : 'Delete for me'}
                          >
                            {deletingId === msg.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                          {deleteMenuFor === msg.id && (
                            <div
                              className={clsx(
                                'absolute z-20 mt-1 w-44 rounded-xl bg-white dark:bg-night-800 border border-surface-100 dark:border-night-600 shadow-lg py-1',
                                isOwn ? 'right-0' : 'left-0'
                              )}
                            >
                              <button
                                onClick={() => handleDelete(msg, 'me')}
                                className="w-full text-left px-3 py-2 text-xs text-surface-700 dark:text-night-100 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors dark:bg-[#1e1e1e]"
                              >
                                Delete for me
                              </button>
                              {canDeleteEveryoneHere && (
                                <button
                                  onClick={() => handleDelete(msg, 'everyone')}
                                  className="w-full text-left px-3 py-2 text-xs text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors"
                                >
                                  Delete for everyone
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
                {/* Threads-lite: nested replies collapse under their parent */}
                {renderThreadSection(msg, isOwn)}
              </div>
            )
          })}
          </>
        )}
      </div>

      {/* Composer / read-only notice */}
      {canChat ? (
        <div className="border-t border-surface-100 dark:border-night-600 p-3 space-y-2">
          {/* Reply context chip */}
          {replyTo && (
            <div className="flex items-center gap-2.5 pl-2.5 pr-2 py-1.5 bg-surface-100 dark:bg-night-700 rounded-xl border-l-2 border-primary-500">
              <Reply size={14} className="text-primary-500 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-primary-600 dark:text-primary-300 truncate">
                  Replying to {replyTo.sender?.name || 'Member'}
                </span>
                <span className="block text-[11px] text-surface-500 dark:text-night-200 truncate">
                  {replyTo.isDeleted
                    ? 'This message was deleted'
                    : replyPreviewText({ content: replyTo.content || '', hasAttachment: !!replyTo.fileUrl })}
                </span>
              </span>
              <button
                onClick={() => setReplyTo(null)}
                disabled={sending}
                className="p-1 rounded-lg text-surface-400 dark:text-night-300 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors disabled:opacity-50"
                title="Cancel reply"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {/* Editing message indicator */}
          {editingMessage && (
            <div className="flex items-center gap-2.5 pl-2.5 pr-2 py-1.5 bg-primary-50 dark:bg-primary-500/10 rounded-xl border-l-2 border-primary-500">
              <Pencil size={14} className="text-primary-500 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-primary-600 dark:text-primary-300">Editing message</span>
              </span>
              <button
                onClick={() => { setEditingMessage(null); setDraft('') }}
                disabled={sending}
                className="p-1 rounded-lg text-surface-400 dark:text-night-300 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors disabled:opacity-50"
                title="Cancel editing"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {/* Selected attachment chip */}
          {selectedFile && (
            <div className="flex items-center gap-2.5 pl-2.5 pr-2 py-1.5 bg-surface-100 dark:bg-night-700 rounded-xl">
              <FileIcon fileName={selectedFile.name} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-surface-900 dark:text-night-50 truncate">{selectedFile.name}</span>
                <span className="block text-[10px] text-surface-400 dark:text-night-300">{formatFileSize(selectedFile.size)}</span>
              </span>
              <button
                onClick={() => setSelectedFile(null)}
                disabled={sending}
                className="p-1 rounded-lg text-surface-400 dark:text-night-300 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors disabled:opacity-50"
                title="Remove attachment"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              onChange={handleFilePicked}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="p-2.5 rounded-xl bg-surface-100 dark:bg-night-700 text-surface-500 dark:text-night-200 hover:bg-surface-200 dark:hover:bg-night-600 disabled:opacity-50 transition-all shrink-0"
              title="Attach a file"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder={editingMessage ? 'Edit your message...' : (selectedFile ? 'Add a caption (optional)...' : 'Type a message...')}
              className="flex-1 resize-none px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-surface-50 dark:bg-night-850 text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 max-h-28"
            />
            <button
              onClick={handleSend}
              disabled={editingMessage ? (!draft.trim() || sending) : ((!draft.trim() && !selectedFile) || sending)}
              className="p-2.5 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl hover:shadow-lg disabled:opacity-50 transition-all shrink-0"
              title="Send"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-surface-100 dark:border-night-600 px-4 py-3 flex items-center gap-2 bg-surface-50 dark:bg-night-850">
          <Eye size={15} className="text-surface-400 dark:text-night-300 shrink-0" />
          <p className="text-xs text-surface-500 dark:text-night-200">{readOnlyNotice(chatMode)}</p>
        </div>
      )}

      {/* Forward picker */}
      <ForwardModal
        open={!!forwardTarget}
        onClose={() => setForwardTarget(null)}
        sourceRoomId={roomId}
        messageId={forwardTarget?.id || ''}
      />
    </div>
  )
}
