import React from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, Calendar, Settings, MessageCircle, Home } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider } from "@/components/ui/sidebar";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { name: "Dashboard", href: "/", icon: Home },
    { name: "Materialen", href: "/materialen", icon: BookOpen },
    { name: "Planning", href: "/planning", icon: Calendar },
    { name: "Coaching", href: "/coaching", icon: MessageCircle },
    { name: "Instellingen", href: "/instellingen", icon: Settings },
  ];

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
