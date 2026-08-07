-- Add status and updated_at columns to notifications table
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'resolved')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(user_id, status);

-- Update existing records to have status based on read flag
UPDATE public.notifications
SET status = CASE 
  WHEN read = true THEN 'read'
  ELSE 'pending'
END
WHERE status IS NULL OR status = 'pending';

COMMENT ON COLUMN public.notifications.status IS 'pending: unread, read: marked as read, resolved: resolved/dismissed';
COMMENT ON COLUMN public.notifications.updated_at IS 'Last update timestamp';
