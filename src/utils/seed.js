import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Doctor from '../models/Doctor.js';
import Hospital from '../models/Hospital.js';
import Schedule from '../models/Schedule.js';

const hospitals=[
 ['Dhaka Heart Centre','hospital1@doctorbd.test','Dhanmondi, Dhaka',['Cardiology','Medicine','ICU'],42,true],
 ['Popular Medical Centre','hospital2@doctorbd.test','Mirpur, Dhaka',['Medicine','Dental','ENT'],31,false],
 ['City Women’s Hospital','hospital3@doctorbd.test','Uttara, Dhaka',['Gynecology','Pediatrics'],24,true]
];
const docs=[
 ['Dr. Farhana Rahman','farhana@doctorbd.test','Cardiology','MBBS, FCPS (Medicine)',12,'Dhaka Heart Centre','Dhanmondi, Dhaka',800,'Female'],
 ['Dr. Ahsan Karim','ahsan@doctorbd.test','Medicine','MBBS, MD (Internal Medicine)',9,'Popular Medical Centre','Mirpur, Dhaka',600,'Male'],
 ['Dr. Nusrat Jahan','nusrat@doctorbd.test','Gynecology','MBBS, FCPS (Gynae)',10,'City Women’s Hospital','Uttara, Dhaka',700,'Female'],
 ['Dr. Tanvir Hasan','tanvir@doctorbd.test','Orthopedics','MBBS, MS (Ortho)',14,'Green Valley Hospital','Mohammadpur, Dhaka',900,'Male']
];
async function user(name,email,role){
 let u=await User.findOne({email});
 if(!u)u=await User.create({name,email,passwordHash:await bcrypt.hash('Demo1234!',12),role});
 return u;
}
await mongoose.connect(process.env.MONGO_URI);
await user('DoctorBD Admin','admin@doctorbd.test','admin');
const hospitalMap=new Map();
for(const [name,email,location,departments,doctors,emergency] of hospitals){
 const u=await user(name,email,'hospital');
 let h=await Hospital.findOne({name});
 if(!h)h=await Hospital.create({user:u._id,name,email,location,city:'Dhaka',departments,doctors,emergency,verified:true});
 else {h.user=h.user||u._id;h.email=h.email||email;await h.save();}
 hospitalMap.set(name,h);
}
for(const [name,email,specialty,qualification,experience,hospitalName,location,fee,gender] of docs){
 const u=await user(name,email,'doctor');
 let d=await Doctor.findOne({user:u._id});
 const h=hospitalMap.get(hospitalName);
 if(!d)d=await Doctor.create({user:u._id,name,specialty,qualification,experience,hospital:hospitalName,hospitals:h?[h._id]:[],location,city:'Dhaka',fee,gender,verified:true,availability:'Available Today',scheduleDays:['Sunday','Monday','Wednesday'],scheduleStart:'8:00 AM',scheduleEnd:'4:00 PM',image:`https://i.pravatar.cc/160?u=${email}`});
 else {d.hospitals=d.hospitals?.length?d.hospitals:(h?[h._id]:[]);d.hospital=d.hospital||hospitalName;await d.save();}
 const date=new Date().toISOString().slice(0,10);
 if(!await Schedule.findOne({doctor:d._id,date}))await Schedule.create({doctor:d._id,date,serials:Array.from({length:20},(_,i)=>({number:i+1,available:i%5!==0}))});
}

await mongoose.disconnect();
