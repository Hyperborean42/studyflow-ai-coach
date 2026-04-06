import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormDescription, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, User, Volume2, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  useGetSettings,
  useUpdateSettings,
  useGetNotificationSettings,
  useUpdateNotificationSettings
} from "@workspace/api-client-react";

const profileSchema = z.object({
  userName: z.string().min(2, "Naam moet minimaal 2 karakters zijn"),
  difficultyLevel: z.enum(["makkelijk", "gemiddeld", "moeilijk"]),
  coachStyle: z.enum(["streng", "gebalanceerd", "aanmoedigend"]),
  weeklyGoalHours: z.coerce.number().min(1).max(100),
  voiceEnabled: z.boolean(),
});

const notificationSchema = z.object({
  enabled: z.boolean(),
  eveningReminder: z.boolean(),
  eveningReminderTime: z.string(),
});

export default function Instellingen() {
  const { toast } = useToast();
  
  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const updateSettings = useUpdateSettings();
  
  const { data: notifSettings, isLoading: loadingNotifs } = useGetNotificationSettings();
  const updateNotifs = useUpdateNotificationSettings();

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      userName: "",
      difficultyLevel: "gemiddeld",
      coachStyle: "gebalanceerd",
      weeklyGoalHours: 10,
      voiceEnabled: true,
    }
  });

  const notifForm = useForm<z.infer<typeof notificationSchema>>({
    resolver: zodResolver(notificationSchema),
    defaultValues: {
      enabled: false,
      eveningReminder: true,
      eveningReminderTime: "21:00",
    }
  });

  useEffect(() => {
    if (settings) {
      profileForm.reset({
        userName: settings.userName,
        difficultyLevel: settings.difficultyLevel as any,
        coachStyle: settings.coachStyle as any,
        weeklyGoalHours: settings.weeklyGoalHours,
        voiceEnabled: settings.voiceEnabled,
      });
    }
  }, [settings, profileForm]);

  useEffect(() => {
    if (notifSettings) {
      notifForm.reset({
        enabled: notifSettings.enabled,
        eveningReminder: notifSettings.eveningReminder,
        eveningReminderTime: notifSettings.eveningReminderTime,
      });
    }
  }, [notifSettings, notifForm]);

  const onProfileSubmit = (values: z.infer<typeof profileSchema>) => {
    updateSettings.mutate({ data: values }, {
      onSuccess: () => toast({ title: "Opgeslagen", description: "Profiel instellingen bijgewerkt." }),
      onError: () => toast({ title: "Fout", description: "Kon instellingen niet opslaan.", variant: "destructive" })
    });
  };

  const onNotifSubmit = async (values: z.infer<typeof notificationSchema>) => {
    if (values.enabled && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast({ title: "Let op", description: "Notificaties zijn geblokkeerd in je browser.", variant: "destructive" });
        values.enabled = false;
        notifForm.setValue("enabled", false);
      }
    }

    updateNotifs.mutate({ data: values }, {
      onSuccess: () => toast({ title: "Opgeslagen", description: "Notificatie instellingen bijgewerkt." }),
      onError: () => toast({ title: "Fout", description: "Kon notificaties niet opslaan.", variant: "destructive" })
    });
  };

  if (loadingSettings || loadingNotifs) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="h-full flex flex-col space-y-6 max-w-3xl mx-auto w-full pb-10">
      <header>
        <h1 className="text-xl md:text-3xl font-bold text-foreground">Instellingen</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-0.5">Personaliseer je studiecoach en pas notificaties aan.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Profiel & Voorkeuren
          </CardTitle>
          <CardDescription>Hoe de coach met je communiceert en je niveau afstemt.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-6">
              <FormField
                control={profileForm.control}
                name="userName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Je roepnaam</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={profileForm.control}
                  name="coachStyle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stijl van de Coach</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Kies een stijl" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="aanmoedigend">Aanmoedigend (Supportive)</SelectItem>
                          <SelectItem value="gebalanceerd">Gebalanceerd (Neutraal)</SelectItem>
                          <SelectItem value="streng">Streng (Direct & Zakelijk)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>Bepaalt de toon van de wekelijkse reviews.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="difficultyLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Niveau Lesmateriaal</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Kies niveau" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="makkelijk">Makkelijk (Veel uitleg)</SelectItem>
                          <SelectItem value="gemiddeld">Gemiddeld (Normaal tempo)</SelectItem>
                          <SelectItem value="moeilijk">Moeilijk (Snel & Compact)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>Voor samenvattingen en quizzen.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t">
                <FormField
                  control={profileForm.control}
                  name="weeklyGoalHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weekdoel (Uren)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormDescription>Totaal aantal uren per week dat je wilt studeren.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="voiceEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <Volume2 className="h-4 w-4 text-primary" /> Spraak output
                        </FormLabel>
                        <FormDescription>
                          Laat de coach antwoorden voorlezen.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={updateSettings.isPending} className="gap-2">
                  {updateSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Voorkeuren Opslaan
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notificaties
          </CardTitle>
          <CardDescription>Krijg herinneringen om je doelen te halen.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...notifForm}>
            <form onSubmit={notifForm.handleSubmit(onNotifSubmit)} className="space-y-6">
              <FormField
                control={notifForm.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 bg-muted/20">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Push Notificaties Aan</FormLabel>
                      <FormDescription>
                        {typeof window !== 'undefined' && 'Notification' in window 
                          ? `Huidige status: ${Notification.permission === 'granted' ? 'Toegestaan' : Notification.permission === 'denied' ? 'Geweigerd' : 'Niet ingesteld'}` 
                          : "Notificaties worden niet ondersteund in je browser."}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {notifForm.watch("enabled") && (
                <div className="pl-4 border-l-2 border-primary/20 space-y-4">
                  <FormField
                    control={notifForm.control}
                    name="eveningReminder"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between">
                        <div className="space-y-0.5">
                          <FormLabel>Avond Reminder</FormLabel>
                          <FormDescription>
                            Herinnering sturen om planning voor morgen te bekijken.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {notifForm.watch("eveningReminder") && (
                    <FormField
                      control={notifForm.control}
                      name="eveningReminderTime"
                      render={({ field }) => (
                        <FormItem className="max-w-[200px]">
                          <FormLabel>Tijdstip</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <Button type="submit" disabled={updateNotifs.isPending} className="gap-2">
                  {updateNotifs.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Notificaties Opslaan
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
