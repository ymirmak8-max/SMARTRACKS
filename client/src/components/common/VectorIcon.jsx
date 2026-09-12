import {
  Activity, AlertTriangle, ArrowLeft, Bell, Bot, BriefcaseBusiness, Building2, CalendarDays,
  Camera, Check, CircleCheck, ClipboardList, Clock3, Download, Eye, FileText, Filter,
  GraduationCap, Home, Image, Inbox, LayoutGrid, LockKeyhole, Mail, MapPin, Megaphone,
  MessageCircle, Paperclip, Pencil, Phone, Plus, RefreshCw, Ruler, School, Search, Settings, Target,
  Trash2, TrendingUp, Upload, UserRound, Users, X, XCircle,
} from 'lucide-react';

const icons = {
  activity: Activity, alert: AlertTriangle, back: ArrowLeft, bell: Bell, bot: Bot,
  briefcase: BriefcaseBusiness, building: Building2, calendar: CalendarDays, camera: Camera,
  check: Check, success: CircleCheck, clipboard: ClipboardList, clock: Clock3, download: Download,
  document: FileText, education: GraduationCap, eye: Eye, filter: Filter, grid: LayoutGrid,
  home: Home, image: Image, inbox: Inbox, lock: LockKeyhole, mail: Mail, map: MapPin,
  megaphone: Megaphone, message: MessageCircle, paperclip: Paperclip, pencil: Pencil, phone: Phone, plus: Plus,
  refresh: RefreshCw, ruler: Ruler, school: School, search: Search, settings: Settings,
  target: Target, trash: Trash2, trending: TrendingUp, upload: Upload, user: UserRound,
  users: Users, x: X, error: XCircle,
};

const VectorIcon = ({ name, size = 18, strokeWidth = 2, className = '', ...props }) => {
  const Icon = icons[name] || Inbox;
  return <Icon aria-hidden="true" className={`vector-icon ${className}`.trim()} size={size} strokeWidth={strokeWidth} {...props} />;
};

export default VectorIcon;
