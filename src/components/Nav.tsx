import Link from 'next/link';

export function Nav() {
  const ownerHandle = (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
  return (
    <nav className="sticky top-0 z-30 backdrop-blur-md bg-gray-950/80 border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold tracking-tight text-white text-lg">
          ViralPulse X
        </Link>
        <div className="flex items-center gap-6 text-sm">
          <Link href="/" className="text-gray-300 hover:text-white transition-colors">
            Home
          </Link>
          <Link href={`/@${ownerHandle}`} className="text-gray-300 hover:text-white transition-colors">
            Profile
          </Link>
          <Link href="/dashboard" className="text-gray-300 hover:text-white transition-colors">
            Dashboard
          </Link>
        </div>
      </div>
    </nav>
  );
}
