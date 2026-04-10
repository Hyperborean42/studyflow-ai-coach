import React from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, Calendar, Settings, MessageCircle, Home, Languages } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isMobile = useIsMobile();

  const navItems = [
    { name: "Dashboard", href: "/", icon: Home },
    { name: "Materialen", href: "/materialen", icon: BookOpen },
    { name: "Planning", href: "/planning", icon: Calendar },
    { name: "Coaching", href: "/coaching", icon: MessageCircle },
    { name: "Vertaler", href: "/vertalen", icon: Languages },
    { name: "Instellingen", href: "/instellingen", icon: Settings },
  ];

  if (isMobile) {
    return (
      <div className="flex flex-col h-[100dvh] w-full bg-background">
        <main className="flex-1 overflow-y-auto p-3 pb-1">
          {children}
        </main>
        <nav className="border-t border-border/50 bg-background/95 backdrop-blur-sm safe-area-bottom">
          <div className="flex items-center justify-around py-2">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center gap-0.5 px-2 py-2 min-h-[48px] min-w-[48px] rounded-lg text-[10px] transition-colors active:scale-95 ${
                    isActive
                      ? "text-primary font-medium bg-primary/10"
                      : "text-muted-foreground"
                  }`}
                  data-testid={`nav-${item.name.toLowerCase()}`}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-[100dvh] w-full bg-background">
        <Sidebar className="border-r border-border/50">
          <SidebarHeader className="p-4">
            <h1 className="text-xl font-bold text-primary flex items-center gap-2">
              <span className="bg-primary text-primary-foreground p-1.5 rounded-lg">SF</span>
              StudyFlow AI
            </h1>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.href}
                    tooltip={item.name}
                  >
                    <Link href={item.href} className="flex items-center gap-3 w-full" data-testid={`nav-${item.name.toLowerCase()}`}>
                      <item.icon className="h-5 w-5" />
                      <span>{item.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>

        <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
