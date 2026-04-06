import React, { useState } from "react";
import { format, parseISO, startOfWeek, endOfWeek, addDays, addWeeks, isSameDay } from "date-fns";
import { nl } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Calendar, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock,
  Loader2, Plus, Sparkles, Target, Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SpeechButton } from "@/components/speech-button";
import {
  useListCalendarEvents,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
  useListStudyGoals,
  useCreateStudyGoal,
  useUpdateStudyGoal,
  useDeleteStudyGoal,
} from "@workspace/api-client-react";

// ─── Schemas ────────────────────────────────────────────────────────────────

const goalSchema = z.object({
  title: z.string().min(1, "Titel is verplicht"),
  subject: z.string().min(1, "Vak is verplicht"),
  hoursPerWeek: z.coerce.number().min(1, "Minimaal 1 uur"),
  targetDate: z.string().min(1, "Datum is verplicht"),
});

const eventSchema = z.object({
  title: z.string().min(1, "Titel is verplicht"),
  type: z.string().min(1, "Type is verplicht"),
  subject: z.string().optional(),
  date: z.string().min(1, "Datum is verplicht"),
  startTime: z.string().min(1, "Starttijd is verplicht"),
  endTime: z.string().min(1, "Eindtijd is verplicht"),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function getEventColor(type: string) {
  switch (type) {
    case "studie": return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
    case "toets":
    case "examen": return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
    case "afspraak": return "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300";
    case "vrij": return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300";
    default: return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300";
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Planning() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleMessage, setRescheduleMessage] = useState("");
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [addGoalOpen, setAddGoalOpen] = useState(false);

  const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
  const endDate = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));

  // ─── Data ─────────────────────────────────────────────────────────────

  const { data: calendarEvents = [], isLoading: isLoadingEvents } = useListCalendarEvents({
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });

  const createEvent = useCreateCalendarEvent();
  const updateEvent = useUpdateCalendarEvent();
  const deleteEvent = useDeleteCalendarEvent();

  const { data: goals = [], refetch: refetchGoals } = useListStudyGoals();
  const createGoal = useCreateStudyGoal();
  const updateGoal = useUpdateStudyGoal();
  const deleteGoal = useDeleteStudyGoal();

  // ─── Event form ────────────────────────────────────────────────────────

  const eventForm = useForm<z.infer<typeof eventSchema>>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: "",
      type: "studie",
      subject: "",
      date: format(new Date(), "yyyy-MM-dd"),
      startTime: "15:30",
      endTime: "17:00",
    },
  });

  const onEventSubmit = (values: z.infer<typeof eventSchema>) => {
    const start = new Date(`${values.date}T${values.startTime}:00`);
    const end = new Date(`${values.date}T${values.endTime}:00`);

    createEvent.mutate(
      {
        data: {
          title: values.title,
          type: values.type as "studie" | "afspraak" | "vrij",
          subject: values.subject || undefined,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Event toegevoegd" });
          eventForm.reset();
          setAddEventOpen(false);
        },
        onError: () => toast({ title: "Fout", variant: "destructive" }),
      },
    );
  };

  // ─── Goal form ─────────────────────────────────────────────────────────

  const goalForm = useForm<z.infer<typeof goalSchema>>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      title: "",
      subject: "",
      hoursPerWeek: 4,
      targetDate: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split("T")[0],
    },
  });

  const onGoalSubmit = (values: z.infer<typeof goalSchema>) => {
    createGoal.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast({ title: "Doel toegevoegd" });
          goalForm.reset();
          setAddGoalOpen(false);
          refetchGoals();
        },
        onError: () => toast({ title: "Fout", variant: "destructive" }),
      },
    );
  };

  // ─── AI Reschedule ─────────────────────────────────────────────────────

  const handleReschedule = async () => {
    setIsRescheduling(true);
    setRescheduleMessage("");

    try {
      const res = await fetch(import.meta.env.BASE_URL + "api/agent/auto-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStartDate: startDate.toISOString() }),
      });

      if (!res.ok) throw new Error("Plan mislukt");
      const data = await res.json();
      setRescheduleMessage(
        data.reasoning ||
          `${data.created} studieblokken aangemaakt voor deze week.`,
      );
      toast({ title: "Planning bijgewerkt", description: `${data.created} studieblokken aangemaakt.` });
    } catch {
      toast({ title: "Fout", description: "Herplannen mislukt.", variant: "destructive" });
    } finally {
      setIsRescheduling(false);
    }
  };

  const handleStatusToggle = (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "voltooid" ? "actief" : "voltooid";
    updateGoal.mutate({ id, data: { status: newStatus as "actief" | "voltooid" } }, {
      onSuccess: () => refetchGoals(),
    });
  };

  const toggleEventComplete = (event: { id: number; completed: boolean }) => {
    updateEvent.mutate({ id: event.id, data: { completed: !event.completed } });
  };

  // ─── Navigation ────────────────────────────────────────────────────────

  const goToWeek = (offset: number) => setCurrentDate(addWeeks(currentDate, offset));
  const goToToday = () => setCurrentDate(new Date());
  const isCurrentWeek = isSameDay(startOfWeek(new Date(), { weekStartsOn: 1 }), startDate);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl md:text-3xl font-bold">Planning & Doelen</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 hidden md:block">Beheer je agenda, toetsen en studiedoelen.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleReschedule} disabled={isRescheduling}>
            {isRescheduling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            AI Plan
          </Button>

          <Dialog open={addEventOpen} onOpenChange={setAddEventOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Nieuw Event
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nieuw Event Toevoegen</DialogTitle>
              </DialogHeader>
              <Form {...eventForm}>
                <form onSubmit={eventForm.handleSubmit(onEventSubmit)} className="space-y-4">
                  <FormField control={eventForm.control} name="title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Titel</FormLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input placeholder="Bijv. Wiskunde toets H3" {...field} />
                          <SpeechButton onTranscript={(t) => field.onChange(field.value ? field.value + " " + t : t)} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={eventForm.control} name="type" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="studie">Studieblok</SelectItem>
                            <SelectItem value="toets">Toets</SelectItem>
                            <SelectItem value="examen">Examen</SelectItem>
                            <SelectItem value="afspraak">Afspraak</SelectItem>
                            <SelectItem value="vrij">Vrij</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={eventForm.control} name="subject" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vak (optioneel)</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input placeholder="Bijv. Wiskunde" {...field} />
                            <SpeechButton onTranscript={(t) => field.onChange(field.value ? field.value + " " + t : t)} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={eventForm.control} name="date" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Datum</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={eventForm.control} name="startTime" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Starttijd</FormLabel>
                        <FormControl><Input type="time" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={eventForm.control} name="endTime" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Eindtijd</FormLabel>
                        <FormControl><Input type="time" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <Button type="submit" className="w-full" disabled={createEvent.isPending}>
                    {createEvent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Toevoegen
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* AI reschedule message */}
      {isRescheduling && rescheduleMessage && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3">
              <Loader2 className="h-4 w-4 text-primary animate-spin mt-0.5 shrink-0" />
              <div className="text-sm whitespace-pre-wrap">{rescheduleMessage}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 flex-1 min-h-0 overflow-hidden">
        {/* Week Calendar */}
        <Card className="md:col-span-8 flex flex-col h-full overflow-hidden">
          <CardHeader className="pb-2 md:pb-3 border-b px-3 md:px-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm md:text-lg flex items-center gap-1.5">
                <Calendar className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                <span className="hidden md:inline">Weekkalender</span>
                <span className="md:hidden">Week</span>
              </CardTitle>
              <div className="flex items-center gap-0.5">
                {!isCurrentWeek && (
                  <Button variant="outline" size="sm" className="text-[10px] md:text-xs h-6 md:h-7 mr-0.5" onClick={goToToday}>
                    Nu
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7" onClick={() => goToWeek(-1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs md:text-sm font-medium min-w-[100px] md:min-w-[140px] text-center">
                  {format(startDate, "d MMM", { locale: nl })} – {format(endDate, "d MMM", { locale: nl })}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7" onClick={() => goToWeek(1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {isLoadingEvents ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
                </div>
              ) : (
                weekDays.map((day) => {
                  const dayEvents = calendarEvents.filter(
                    (e: { startTime: string }) => isSameDay(new Date(e.startTime), day),
                  );
                  const isToday = isSameDay(day, new Date());

                  return (
                    <div key={day.toString()} className="space-y-2">
                      <h4 className={`text-sm font-medium ${isToday ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                        {format(day, "EEEE d MMM", { locale: nl })}
                        {isToday && <Badge variant="outline" className="ml-2 text-[10px]">Vandaag</Badge>}
                      </h4>
                      {dayEvents.length > 0 ? (
                        <div className="space-y-1.5 pl-3 border-l-2 border-muted">
                          {dayEvents.map((event: { id: number; type: string; completed: boolean; title: string; startTime: string; endTime: string; subject?: string }) => (
                            <div
                              key={event.id}
                              className={`p-2 rounded-md border text-sm flex items-center gap-2 transition-opacity ${getEventColor(event.type)} ${event.completed ? "opacity-50" : ""}`}
                            >
                              <button
                                className="shrink-0"
                                onClick={() => toggleEventComplete(event)}
                              >
                                {event.completed ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Circle className="h-4 w-4" />
                                )}
                              </button>
                              <div className="flex-1 min-w-0">
                                <span className={`font-medium ${event.completed ? "line-through" : ""}`}>
                                  {event.title}
                                </span>
                                {event.subject && (
                                  <span className="text-xs opacity-70 ml-1">({event.subject})</span>
                                )}
                              </div>
                              <span className="text-xs opacity-70 shrink-0">
                                {format(new Date(event.startTime), "HH:mm")}–{format(new Date(event.endTime), "HH:mm")}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 opacity-50 hover:opacity-100 hover:text-destructive"
                                onClick={() => deleteEvent.mutate({ id: event.id })}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground italic pl-5">Geen items</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Right column: Goals */}
        <div className="md:col-span-4 flex flex-col gap-5 h-full overflow-y-auto">
          <Card className="flex flex-col flex-1 overflow-hidden">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  Studiedoelen
                </CardTitle>
                <Dialog open={addGoalOpen} onOpenChange={setAddGoalOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7">
                      <Plus className="h-3 w-3 mr-1" /> Doel
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Nieuw Studiedoel</DialogTitle>
                    </DialogHeader>
                    <Form {...goalForm}>
                      <form onSubmit={goalForm.handleSubmit(onGoalSubmit)} className="space-y-4">
                        <FormField control={goalForm.control} name="title" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Wat is je doel?</FormLabel>
                            <FormControl>
                              <div className="flex gap-2">
                                <Input placeholder="Bijv. Alle stof voor tentamen kennen" {...field} />
                                <SpeechButton onTranscript={(t) => field.onChange(field.value ? field.value + " " + t : t)} />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={goalForm.control} name="subject" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Vak</FormLabel>
                            <FormControl><Input placeholder="Bijv. Wiskunde B" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-3">
                          <FormField control={goalForm.control} name="targetDate" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Deadline</FormLabel>
                              <FormControl><Input type="date" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={goalForm.control} name="hoursPerWeek" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Uren/week</FormLabel>
                              <FormControl><Input type="number" min="1" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <Button type="submit" className="w-full" disabled={createGoal.isPending}>
                          {createGoal.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Doel Toevoegen
                        </Button>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <ScrollArea className="flex-1">
              <CardContent className="p-4 space-y-3">
                {goals.length > 0 ? (
                  goals.map((goal) => (
                    <div
                      key={goal.id}
                      className={`p-3 rounded-lg border ${goal.status === "voltooid" ? "bg-muted/50 opacity-70" : "bg-card"}`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => handleStatusToggle(goal.id, goal.status)}
                          className="mt-0.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
                        >
                          {goal.status === "voltooid" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <Circle className="h-4 w-4" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-sm font-medium ${goal.status === "voltooid" ? "line-through text-muted-foreground" : ""}`}>
                            {goal.title}
                          </h4>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <Badge variant="outline" className="text-[10px]">{goal.subject}</Badge>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                              <Calendar className="h-3 w-3" />
                              {format(parseISO(goal.targetDate), "d MMM", { locale: nl })}
                            </span>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />
                              {goal.hoursPerWeek}u/wk
                            </span>
                          </div>
                          <div className="mt-2">
                            <div className="flex justify-between text-[11px] mb-0.5">
                              <span>Voortgang</span>
                              <span>{goal.progress}%</span>
                            </div>
                            <Progress value={goal.progress} className="h-1.5" />
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-destructive/50 hover:text-destructive"
                          onClick={() => deleteGoal.mutate({ id: goal.id }, { onSuccess: () => refetchGoals() })}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <Target className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Nog geen doelen.</p>
                    <p className="text-xs text-muted-foreground">Klik + om je eerste doel toe te voegen.</p>
                  </div>
                )}
              </CardContent>
            </ScrollArea>
          </Card>
        </div>
      </div>
    </div>
  );
}
