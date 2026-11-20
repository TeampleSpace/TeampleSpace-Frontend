import { InvitationDialog } from './Invitation.tsx'

export function JoinProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <InvitationDialog open={open} onClose={onClose} />
}
