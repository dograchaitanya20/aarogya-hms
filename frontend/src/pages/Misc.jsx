import { Link } from 'react-router-dom';
import { Compass, Lock } from 'lucide-react';
import { Empty } from '../components/ui.jsx';
import { HOME, useAuth } from '../lib/auth.jsx';

export function Forbidden() {
  const { user } = useAuth();
  return (
    <Empty icon={Lock} title="This page is not part of your role" action={<Link className="link text-sm" to={HOME[user.role]}>Go to your home page</Link>}>
      The server enforces this too, so it is not just hidden from the menu.
    </Empty>
  );
}

export function NotFound() {
  const { user } = useAuth();
  return (
    <Empty icon={Compass} title="That page does not exist" action={<Link className="link text-sm" to={user ? HOME[user.role] : '/login'}>Go back</Link>}>
      Check the address or use the menu.
    </Empty>
  );
}
