export function LandingFooter() {
  return (
    <footer className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Moatify &middot; &copy; 2025 Moatify. All rights reserved.
        </p>
        <div className="flex gap-4">
          <a href="#" className="text-sm text-muted-foreground hover:text-foreground">
            Privacy Policy
          </a>
          <a href="#" className="text-sm text-muted-foreground hover:text-foreground">
            Terms of Service
          </a>
        </div>
      </div>
    </footer>
  );
}
