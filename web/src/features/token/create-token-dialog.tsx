import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { tokenApi } from '@/api/client'
import { useCopyToClipboard } from '@/shared/lib/clipboard'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input, INPUT_BASE_CLASS_NAME } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { cn } from '@/shared/lib/utils'
import { centeredToastOptions, toast } from '@/shared/lib/toast'
import { formatLocalDateTime } from '@/shared/lib/date-time'
import type { CreateTokenRequest, CreateTokenResponse } from '@/api/types'
import { resolveTokenExpiresAt, toLocalDateTimeInputValue, type TokenExpirationMode } from './token-expiration'

interface CreateTokenDialogProps {
  children: React.ReactNode
  existingNames?: string[]
}

const MAX_TOKEN_NAME_LENGTH = 64

/**
 * Handles API token creation, including duplicate-name checks, expiration
 * selection, and the one-time reveal of the raw token value after creation.
 */
export function CreateTokenDialog({ children, existingNames = [] }: CreateTokenDialogProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [createdToken, setCreatedToken] = useState<CreateTokenResponse | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [expirationMode, setExpirationMode] = useState<TokenExpirationMode>('never')
  const [customExpiresAt, setCustomExpiresAt] = useState('')
  const [expiresAtError, setExpiresAtError] = useState<string | null>(null)
  const [, copy] = useCopyToClipboard()
  const queryClient = useQueryClient()
  const createdTokenRef = useRef<CreateTokenResponse | null>(null)
  createdTokenRef.current = createdToken

  const normalizedName = name.trim()
  const hasDuplicateName = existingNames.some(
    (existingName) => existingName.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
  )

  const createMutation = useMutation({
    mutationFn: (request: CreateTokenRequest) => tokenApi.createToken(request),
    onSuccess: (data) => {
      // Switch to the reveal view only; reset form fields when the dialog closes.
      // Native <select> avoids Radix Select body portals that race with our custom Dialog portal.
      setCreatedToken(data)
    },
  })

  const refreshTokenList = () => {
    queryClient.invalidateQueries({ queryKey: ['tokens'] })
  }

  const resetTransientState = () => {
    setCreatedToken(null)
    setName('')
    setNameError(null)
    setExpirationMode('never')
    setCustomExpiresAt('')
    setExpiresAtError(null)
    createMutation.reset()
  }

  const closeDialog = (refreshList: boolean) => {
    if (refreshList) {
      refreshTokenList()
    }
    resetTransientState()
    setOpen(false)
  }

  const handleCreate = () => {
    if (!normalizedName) {
      setNameError(t('createToken.nameRequired'))
      return
    }
    if (normalizedName.length > MAX_TOKEN_NAME_LENGTH) {
      setNameError(t('createToken.nameTooLong', { max: MAX_TOKEN_NAME_LENGTH }))
      return
    }
    if (hasDuplicateName) {
      setNameError(t('createToken.nameDuplicate'))
      return
    }

    const expiresAt = resolveTokenExpiresAt(expirationMode, customExpiresAt)
    if (expirationMode === 'custom' && !expiresAt) {
      setExpiresAtError(t('createToken.expiresAtRequired'))
      return
    }

    setNameError(null)
    setExpiresAtError(null)
    createMutation.mutate({ name: normalizedName, expiresAt })
  }

  const handleClose = (refreshList = false) => {
    closeDialog(refreshList || createdTokenRef.current !== null)
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      resetTransientState()
      setOpen(true)
      return
    }
    closeDialog(createdTokenRef.current !== null)
  }

  const handleCopyToken = async () => {
    if (!createdToken) return

    try {
      await copy(createdToken.token)
      toast.success(t('createToken.copySuccess'), undefined, centeredToastOptions())
    } catch (error) {
      console.error('Failed to copy token:', error)
      toast.error(t('createToken.copyFailed'), undefined, centeredToastOptions())
    }
  }

  const formatExpiresAt = (expiresAt?: string) => {
    if (!expiresAt) {
      return t('token.neverExpires')
    }
    return formatLocalDateTime(expiresAt, i18n.language)
  }

  const minDateTime = toLocalDateTimeInputValue(new Date())

  return (
    // Reopening the dialog resets transient creation state because the raw token
    // is only meant to be shown once, immediately after a successful create call.
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        {!createdToken ? (
          <>
            <DialogHeader className="text-center sm:text-center">
              <DialogTitle className="text-center">{t('createToken.title')}</DialogTitle>
              <DialogDescription className="text-center">
                {t('createToken.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">{t('createToken.nameLabel')}</Label>
                <Input
                  id="token-name"
                  placeholder={t('createToken.namePlaceholder')}
                  value={name}
                  maxLength={MAX_TOKEN_NAME_LENGTH}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (nameError) {
                      setNameError(null)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreate()
                    }
                  }}
                  aria-invalid={nameError || hasDuplicateName ? 'true' : 'false'}
                />
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-red-600">
                    {nameError ?? (hasDuplicateName && normalizedName ? t('createToken.nameDuplicate') : '')}
                  </span>
                  <span className="text-muted-foreground">
                    {normalizedName.length}/{MAX_TOKEN_NAME_LENGTH}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="token-expiration">{t('createToken.expirationLabel')}</Label>
                <select
                  id="token-expiration"
                  className={cn(INPUT_BASE_CLASS_NAME, 'appearance-none bg-secondary/50')}
                  value={expirationMode}
                  onChange={(event) => {
                    setExpirationMode(event.target.value as TokenExpirationMode)
                    setExpiresAtError(null)
                  }}
                >
                  <option value="never">{t('createToken.expirationNever')}</option>
                  <option value="7d">{t('createToken.expiration7d')}</option>
                  <option value="30d">{t('createToken.expiration30d')}</option>
                  <option value="90d">{t('createToken.expiration90d')}</option>
                  <option value="custom">{t('createToken.expirationCustom')}</option>
                </select>
                {expirationMode === 'custom' ? (
                  <Input
                    id="token-custom-expiration"
                    type="datetime-local"
                    value={customExpiresAt}
                    min={minDateTime}
                    onChange={(e) => {
                      setCustomExpiresAt(e.target.value)
                      if (expiresAtError) {
                        setExpiresAtError(null)
                      }
                    }}
                  />
                ) : null}
                {expiresAtError ? (
                  <p className="text-xs text-red-600">{expiresAtError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('createToken.expirationHint')}</p>
                )}
              </div>
            </div>
            {createMutation.error ? (
              <p className="text-sm text-red-600">{createMutation.error.message}</p>
            ) : null}
            <DialogFooter className="sm:justify-center sm:space-x-3">
              <Button variant="outline" onClick={() => handleClose()}>
                {t('dialog.cancel')}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!normalizedName || hasDuplicateName || createMutation.isPending}
              >
                {createMutation.isPending ? t('createToken.creating') : t('createToken.create')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="min-w-0 text-center sm:text-center">
              <DialogTitle className="text-center">{t('createToken.successTitle')}</DialogTitle>
              <DialogDescription className="text-center break-words">
                {t('createToken.successDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0 space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t('createToken.tokenLabel')}</Label>
                <div className="overflow-hidden rounded-md bg-muted p-3 font-mono text-sm break-all">
                  {createdToken.token}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('createToken.nameDisplay')}</Label>
                <div className="text-sm break-all">{createdToken.name}</div>
              </div>
              <div className="space-y-2">
                <Label>{t('createToken.expiresAtDisplay')}</Label>
                <div className="text-sm">{formatExpiresAt(createdToken.expiresAt)}</div>
              </div>
            </div>
            <DialogFooter className="sm:justify-center sm:space-x-3">
              <Button onClick={handleCopyToken}>
                {t('createToken.copyToken')}
              </Button>
              <Button variant="outline" onClick={() => handleClose()}>
                {t('dialog.close')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
