import React, { useState } from "react";
import { format, parseISO } from "date-fns";
import { nl } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, CheckCircle2, Circle, Clock, Loader2, Sparkles, Target, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  useListStudyGoals, 
  useCreateStudyGoal,
  useUpdateStudyGoal,
  useDeleteStudyGoal
} from "@workspace/api-client-react";
import { streamOpenAiResponse } from "@/lib/api-streaming";

const goalSchema = z.object({
  title: z.string().min(1, "Titel is verplicht"),
  subject: z.string().min(1, "Vak is verplicht"),
  hoursPerWeek: z.coerce.number().min(1, "Minimaal 1 uur"),
  targetDate: z.string().min(1, "Datum is verplicht"),
});

export default function Planning() {
  const { toast } = useToast();
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleMessage, setRescheduleMessage] = useState("");
  
  const { data: goals = [], refetch } = useListStudyGoals();
  const createGoal = useCreateStudyGoal();
  const updateGoal = useUpdateStudyGoal();
  const deleteGoal = useDeleteStudyGoal();

  const form = useForm<z.infer<typeof goalSchema>>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      title: "",
      subject: "",
      hoursPerWeek: 4,
      targetDate: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0],
    },
  });

  const onSubmit = (values: z.infer<typeof goalSchema>) => {
    createGoal.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Doel toegevoegd" });
        form.reset();
        refetch();
      },
      onError: () => toast({ title: "Fout", variant: "destructive" })
    });
  };

  const handleStatusToggle = (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "voltooid" ? "actief" : "voltooid";
    updateGoal.mutate({ id, data: { status: newStatus as any } }, {
      onSuccess: () => refetch()
    });
  };

  const handleDelete = (id: number) => {
    deleteGoal.mutate({ id }, {
      onSuccess: () => refetch()
    });
  };

  const handleReschedule = async () => {
    setIsRescheduling(true);
    setRescheduleMessage("");
    
    try {
      await streamOpenAiResponse(
        `api/calendar/reschedule-week`,
        { weekStartDate: new Date().toISOString() },
        (chunk) => {
          setRescheduleMessage(prev => prev + chunk);
        }
      );
      toast({ title: "Planning bijgewerkt", description: "Je week is succesvol opnieuw ingedeeld." });
    } catch (error) {
      toast({ title: "Fout", description: "Herplannen mislukt.", variant: "destructive" });
    } finally {
      setIsRescheduling(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'actief': return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none">Actief</Badge>;
      case 'voltooid': return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-none">Voltooid</Badge>;
      case 'gepauzeerd': return <Badge variant="secondary">Gepauzeerd</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Planning & Doelen</h1>
          <p className="text-muted-foreground mt-1">Beheer je studiedoelen en laat AI je week plannen.</p>
        </div>
        <Button 
          onClick={handleReschedule} 
          disabled={isRescheduling}
          className="bg-primary hover:bg-primary/90 text-white gap-2"
        >
          {isRescheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Herplan Mijn Week
        </Button>
      </header>

      {isRescheduling && rescheduleMessage && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <Loader2 className="h-5 w-5 text-primary animate-spin mt-1 shrink-0" />
              <div className="text-sm whitespace-pre-wrap">{rescheduleMessage}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left Column - Goals List */}
        <Card className="md:col-span-8 flex flex-col h-full overflow-hidden">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="text-xl flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Mijn Studiedoelen
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="p-6 space-y-4">
              {goals.length > 0 ? (
                goals.map(goal => (
                  <div key={goal.id} className={`p-4 rounded-xl border ${goal.status === 'voltooid' ? 'bg-muted/50 opacity-80' : 'bg-card shadow-sm'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-start gap-3">
                        <button 
                          onClick={() => handleStatusToggle(goal.id, goal.status)}
                          className="mt-1 text-muted-foreground hover:text-primary transition-colors"
                        >
                          {goal.status === 'voltooid' ? 
                            <CheckCircle2 className="h-5 w-5 text-green-500" /> : 
                            <Circle className="h-5 w-5" />
                          }
                        </button>
                        <div>
                          <h3 className={`font-semibold ${goal.status === 'voltooid' ? 'line-through text-muted-foreground' : ''}`}>
                            {goal.title}
                          </h3>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <Badge variant="outline" className="text-[10px] font-normal">{goal.subject}</Badge>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="h-3 w-3" /> {format(parseISO(goal.targetDate), 'd MMM yyyy', { locale: nl })}
                            </span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {goal.hoursPerWeek}u / week
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {getStatusBadge(goal.status)}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(goal.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="mt-4 pl-8">
                      <div className="flex justify-between text-xs mb-1">
                        <span>Voortgang</span>
                        <span>{goal.progress}%</span>
                      </div>
                      <Progress value={goal.progress} className="h-2" />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 border-2 border-dashed rounded-xl">
                  <Target className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-foreground">Nog geen doelen</h3>
                  <p className="text-muted-foreground text-sm mt-1 mb-4">Stel je eerste studiedoel in om te beginnen.</p>
                </div>
              )}
            </CardContent>
          </ScrollArea>
        </Card>

        {/* Right Column - Add Goal Form */}
        <Card className="md:col-span-4 h-max">
          <CardHeader>
            <CardTitle className="text-lg">Nieuw Doel</CardTitle>
            <CardDescription>Waar wil je naartoe werken?</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Wat is je doel?</FormLabel>
                      <FormControl>
                        <Input placeholder="Bijv. Alle stof voor tentamen kennen" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vak</FormLabel>
                      <FormControl>
                        <Input placeholder="Bijv. Wiskunde B" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="targetDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Deadline</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hoursPerWeek"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Uren/week</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <Button type="submit" className="w-full mt-2" disabled={createGoal.isPending}>
                  {createGoal.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Doel Toevoegen
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
